import { execFile } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

import { type CheckContext, type CheckResult, type Ddl, changeStatusOf, runChecks } from './checks';
import { EVALS_DIRECTORY, type GoldenCase, type GoldenSet } from './golden-set';
import { type Artifact, type Judgement, judgeRun } from './judge';
import {
  type ChangedFile,
  type ClaudeRun,
  type ToolUse,
  collectChangedFiles,
  createSandbox,
  describeRunFailure,
  removeSandbox,
  runClaude,
} from './runner';

/** Per-file and per-run caps on what the judge is shown; beyond them a file is marked truncated. */
export const ARTIFACT_CONTENT_LIMIT_BYTES = 24 * 1024;
export const ARTIFACT_TOTAL_LIMIT_BYTES = 120 * 1024;
const BINARY_SNIFF_BYTES = 8 * 1024;
/** How much of a tool call's command or query the report keeps; the transcript itself is not. */
export const TOOL_TARGET_LIMIT_CHARS = 160;
/** How much of the harness's stderr a run carries into the report. */
export const STDERR_TAIL_LIMIT_CHARS = 2000;

const execFileAsync = promisify(execFile);

export type RunOptions = {
  /** The agent model for cases that declare none. */
  readonly agentModel: string;
  /** The agent model for every case, whatever it declares. */
  readonly overrideModel?: string;
  readonly judgeModel: string;
  readonly maxBudgetUsd: number;
  readonly judgeMaxBudgetUsd: number;
  readonly timeoutMs: number;
  readonly judgeTimeoutMs: number;
  readonly keepSandbox: boolean;
  readonly ddl: () => Ddl;
};

/** One tool call as the report keeps it: the tool, and the file, command or query it was aimed at. */
export type ToolUseSummary = { readonly name: string; readonly target?: string };

/** What the harness said about its own process — the facts a run that went wrong is read by. */
export type HarnessFacts = {
  readonly exitCode: number | null;
  readonly resultSubtype?: string;
  readonly numTurns?: number;
  /** The tail of the harness's stderr, when it wrote any. */
  readonly stderr?: string;
};

export type RunResult = {
  readonly runIndex: number;
  /** The agent model this run actually used. */
  readonly agentModel: string;
  /** Every check passed, every `error` assertion passed and the score met the threshold. */
  readonly passed: boolean;
  /** The harness or the judge failed, so nothing was graded; excluded from pass rates. */
  readonly errored: boolean;
  readonly failure?: string;
  readonly costUsd: number;
  readonly judgeCostUsd: number;
  readonly costEstimated: boolean;
  readonly durationMs: number;
  readonly skillsUsed: readonly string[];
  /** What git sees changed in the sandbox against its baseline commit. */
  readonly changedFiles: readonly string[];
  readonly checks: readonly CheckResult[];
  readonly judgement?: Judgement;
  readonly scorePassed: boolean;
  readonly assertionsPassed: boolean;
  /** The agent's final message; empty when the run produced none. */
  readonly answer: string;
  /** Every tool call of the run, in order — the record a claim in the final message is checked against. */
  readonly toolUses: readonly ToolUseSummary[];
  readonly harness?: HarnessFacts;
  /** Where the sandbox was left, when `--keep-sandbox` asked for it or the run errored. */
  readonly sandbox?: string;
};

// Asynchronous like the sandbox copy, so a stop signal is handled while git runs, not after it.
async function git(sandbox: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['-c', 'user.name=skill-eval', '-c', 'user.email=skill-eval@invalid', ...args],
    { cwd: sandbox },
  );

  return stdout;
}

/**
 * Removes every skill's `evals/` directory from the sandbox and copies the case's input files in,
 * then commits, so the agent starts from a clean tree that holds the inputs and none of the
 * answers. A golden set left in place would be readable by the agent under test, and an
 * uncommitted input would be graded as something the agent added. Returns that commit, the
 * baseline every change of the run is measured against.
 */
export async function prepareSandbox(
  sandbox: string,
  set: GoldenSet,
  testCase: GoldenCase,
): Promise<string> {
  const skillsRoot = join(sandbox, '.claude', 'skills');

  if (existsSync(skillsRoot)) {
    for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        rmSync(join(skillsRoot, entry.name, EVALS_DIRECTORY), { force: true, recursive: true });
      }
    }
  }

  for (const file of testCase.files) {
    const target = join(sandbox, file.to);

    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(set.directory, file.from), target);
  }

  await git(sandbox, 'add', '-A');
  await git(
    sandbox,
    'commit',
    '--no-verify',
    '--allow-empty',
    '-q',
    '-m',
    'skill-evals: inputs in, golden sets out',
  );

  return (await git(sandbox, 'rev-parse', 'HEAD')).trim();
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/** The changed files with as much of their content as the judge may see. */
export function collectArtifacts(
  sandbox: string,
  changedFiles: readonly ChangedFile[],
): Artifact[] {
  let budget = ARTIFACT_TOTAL_LIMIT_BYTES;

  return changedFiles.map((file) => {
    const status = changeStatusOf(file);

    if (status === 'deleted') {
      return { path: file.path, status, truncated: false };
    }

    const absolute = join(sandbox, file.path);

    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      return { path: file.path, status, truncated: false };
    }

    const buffer = readFileSync(absolute);

    if (looksBinary(buffer) || budget <= 0) {
      return { path: file.path, status, truncated: buffer.length > 0 };
    }

    const limit = Math.min(ARTIFACT_CONTENT_LIMIT_BYTES, budget);
    const content = buffer.subarray(0, limit).toString('utf8');

    budget -= Math.min(buffer.length, limit);

    return { path: file.path, status, content, truncated: buffer.length > limit };
  });
}

function sanitizeLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-');
}

/** The agent model a case runs on: the override, else what the case declares, else the default. */
export function resolveAgentModel(
  testCase: GoldenCase,
  options: Pick<RunOptions, 'agentModel' | 'overrideModel'>,
): string {
  return options.overrideModel ?? testCase.model ?? options.agentModel;
}

/** The prompt as the agent receives it: prefixed with the skill for an explicit invocation. */
export function buildAgentPrompt(set: GoldenSet, testCase: GoldenCase): string {
  return testCase.invocation === 'explicit' ? `/${set.skill} ${testCase.prompt}` : testCase.prompt;
}

/**
 * The skills a run counts as fired. An explicit invocation loads the skill without a `Skill` tool
 * call, so it is added by construction — but only when the harness actually knew the skill, since
 * an undiscovered `/name` is sent to the model as plain text and loads nothing.
 */
export function resolveSkillsUsed(
  set: GoldenSet,
  testCase: GoldenCase,
  run: { readonly skillsUsed: readonly string[]; readonly availableSkills: readonly string[] },
): readonly string[] {
  if (testCase.invocation === 'explicit' && run.availableSkills.includes(set.skill)) {
    return [set.skill, ...run.skillsUsed.filter((skill) => skill !== set.skill)];
  }

  return run.skillsUsed;
}

/** Inputs that name the file a tool works on, then the ones that say what it does. */
const FILE_INPUTS: readonly string[] = ['file_path', 'notebook_path'];
const TEXT_INPUTS: readonly string[] = [
  'command',
  'pattern',
  'skill',
  'url',
  'description',
  'query',
  'prompt',
];
const DIRECTORY_INPUTS: readonly string[] = ['path'];

function findString(input: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];

    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** The sandbox as given and as the filesystem resolves it: the harness may report either form. */
function sandboxRoots(sandbox: string): string[] {
  try {
    const real = realpathSync(sandbox);

    return real === sandbox ? [sandbox] : [sandbox, real];
  } catch {
    return [sandbox];
  }
}

/** A path relative to the sandbox, or marked as lying outside it — which is a finding in itself. */
function describePath(path: string, roots: readonly string[]): string {
  if (!isAbsolute(path)) {
    return path;
  }

  for (const root of roots) {
    if (path === root) {
      return '.';
    }

    if (path.startsWith(`${root}${sep}`)) {
      return relative(root, path);
    }
  }

  return `${path} (outside the sandbox)`;
}

/**
 * One line per tool call — the tool and what it was pointed at — so what the agent did can be read
 * next to what it claimed and what git saw, without keeping the transcript.
 */
export function summarizeToolUses(toolUses: readonly ToolUse[], sandbox: string): ToolUseSummary[] {
  const roots = sandboxRoots(sandbox);

  return toolUses.map((toolUse) => {
    const input = toolUse.input ?? {};
    const file = findString(input, FILE_INPUTS);
    const text = file === undefined ? findString(input, TEXT_INPUTS) : undefined;
    const directory =
      file === undefined && text === undefined ? findString(input, DIRECTORY_INPUTS) : undefined;
    const target =
      file !== undefined
        ? describePath(file, roots)
        : text !== undefined
          ? truncate(text.replace(/\s+/g, ' ').trim(), TOOL_TARGET_LIMIT_CHARS)
          : directory !== undefined
            ? describePath(directory, roots)
            : undefined;

    return target === undefined ? { name: toolUse.name } : { name: toolUse.name, target };
  });
}

function describeHarness(run: ClaudeRun): HarnessFacts {
  const stderr = run.stderr.trim();

  return {
    exitCode: run.code,
    ...(run.result?.subtype === undefined ? {} : { resultSubtype: run.result.subtype }),
    ...(run.result?.num_turns === undefined ? {} : { numTurns: run.result.num_turns }),
    ...(stderr.length === 0 ? {} : { stderr: stderr.slice(-STDERR_TAIL_LIMIT_CHARS) }),
  };
}

/** The changed files, or none when git itself can no longer answer — a sandbox the agent broke. */
function collectChangedFilesSafely(sandbox: string, baseline: string): ChangedFile[] {
  try {
    return collectChangedFiles(sandbox, baseline);
  } catch {
    return [];
  }
}

function pathsOf(changedFiles: readonly ChangedFile[]): string[] {
  return changedFiles.map((file) => file.path);
}

function erroredResult(
  runIndex: number,
  failure: string,
  partial: Partial<RunResult> & {
    readonly agentModel: string;
    readonly costUsd: number;
    readonly durationMs: number;
  },
): RunResult {
  return {
    runIndex,
    passed: false,
    errored: true,
    failure,
    judgeCostUsd: 0,
    costEstimated: true,
    skillsUsed: [],
    changedFiles: [],
    checks: [],
    scorePassed: false,
    assertionsPassed: false,
    answer: '',
    toolUses: [],
    ...partial,
  };
}

/**
 * One run of one case: a fresh sandbox, the agent, the deterministic checks, then the judge when
 * the case asks for one. A run the harness or the judge did not finish is reported as errored
 * rather than failed — an empty sandbox graded as "the model got it wrong" would move the pass
 * rate this suite exists to measure — and so is a run the sandbox itself could not be made or
 * prepared for, so one broken run never takes the rest of the suite down with it. Whatever the
 * outcome, the result carries what the agent did — its tool calls, its final message, what git saw
 * — so a verdict can be read against the evidence.
 */
export async function evaluateCase(
  set: GoldenSet,
  testCase: GoldenCase,
  runIndex: number,
  options: RunOptions,
): Promise<RunResult> {
  const startedAt = Date.now();
  const agentModel = resolveAgentModel(testCase, options);
  const created = await createSandbox(
    sanitizeLabel(`${set.skill}-${testCase.id}-${runIndex}`),
  ).then(
    (root) => ({ root }),
    (error: Error) => ({ error }),
  );

  if ('error' in created) {
    return erroredResult(runIndex, `no sandbox: ${created.error.message}`, {
      agentModel,
      costUsd: 0,
      durationMs: Date.now() - startedAt,
    });
  }

  const sandbox = created.root;
  let keep = options.keepSandbox;

  try {
    const baseline = await prepareSandbox(sandbox, set, testCase);

    const run = await runClaude({
      cwd: sandbox,
      prompt: buildAgentPrompt(set, testCase),
      model: agentModel,
      permissionMode: 'bypassPermissions',
      maxBudgetUsd: options.maxBudgetUsd,
      timeoutMs: options.timeoutMs,
      // The connectors a developer has attached to their own Claude Code are not part of any skill
      // under test, cost tens of thousands of tokens per turn, and could act on real systems.
      strictMcpConfig: true,
    });
    const durationMs = Date.now() - startedAt;
    const observed = {
      answer: run.resultText ?? '',
      toolUses: summarizeToolUses(run.toolUses, sandbox),
      harness: describeHarness(run),
    };
    const failure = describeRunFailure(run);

    if (failure !== undefined) {
      keep = true;
      return erroredResult(runIndex, failure, {
        agentModel,
        costUsd: run.costUsd,
        costEstimated: run.costEstimated,
        durationMs,
        skillsUsed: run.skillsUsed,
        changedFiles: pathsOf(collectChangedFilesSafely(sandbox, baseline)),
        ...observed,
        sandbox,
      });
    }

    if (testCase.invocation === 'explicit' && !run.availableSkills.includes(set.skill)) {
      keep = true;
      return erroredResult(
        runIndex,
        `the harness did not discover the skill "${set.skill}" in the sandbox, so the explicit invocation reached the model as plain text`,
        {
          agentModel,
          costUsd: run.costUsd,
          costEstimated: run.costEstimated,
          durationMs,
          skillsUsed: run.skillsUsed,
          changedFiles: pathsOf(collectChangedFilesSafely(sandbox, baseline)),
          ...observed,
          sandbox,
        },
      );
    }

    const changedFiles = collectChangedFiles(sandbox, baseline);
    const skillsUsed = resolveSkillsUsed(set, testCase, run);
    const context: CheckContext = {
      sandbox,
      changedFiles,
      skillsUsed,
      resultText: observed.answer,
      evalsDirectory: set.directory,
      ddl: options.ddl,
    };
    const checks = runChecks(testCase.checks, context);
    const checksPassed = checks.every((result) => result.passed);
    const graded = {
      runIndex,
      agentModel,
      errored: false,
      costUsd: run.costUsd,
      durationMs,
      skillsUsed,
      changedFiles: pathsOf(changedFiles),
      checks,
      ...observed,
      ...(options.keepSandbox ? { sandbox } : {}),
    };

    if (!testCase.judge) {
      return {
        ...graded,
        passed: checksPassed,
        judgeCostUsd: 0,
        costEstimated: run.costEstimated,
        scorePassed: true,
        assertionsPassed: true,
      };
    }

    const goldenContent =
      testCase.golden === undefined
        ? undefined
        : readFileSync(join(set.directory, testCase.golden), 'utf8');
    const judged = await judgeRun(
      {
        prompt: testCase.prompt,
        expectedOutput: testCase.expectedOutput,
        goldenName: testCase.golden,
        goldenContent,
        answer: observed.answer,
        artifacts: collectArtifacts(sandbox, changedFiles),
        assertions: testCase.assertions,
      },
      {
        model: options.judgeModel,
        maxBudgetUsd: options.judgeMaxBudgetUsd,
        timeoutMs: options.judgeTimeoutMs,
      },
    );

    if (judged.judgement === undefined) {
      keep = true;
      return erroredResult(runIndex, judged.failure ?? 'judge: unknown failure', {
        agentModel,
        costUsd: run.costUsd,
        judgeCostUsd: judged.costUsd,
        costEstimated: run.costEstimated || judged.costEstimated,
        durationMs,
        skillsUsed,
        changedFiles: pathsOf(changedFiles),
        checks,
        ...observed,
        sandbox,
      });
    }

    const assertionsPassed = judged.judgement.assertions.every(
      (verdict) => verdict.passed || verdict.severity === 'warn',
    );
    const scorePassed = judged.judgement.score >= testCase.threshold;

    return {
      ...graded,
      passed: checksPassed && assertionsPassed && scorePassed,
      judgeCostUsd: judged.costUsd,
      costEstimated: run.costEstimated || judged.costEstimated,
      judgement: judged.judgement,
      scorePassed,
      assertionsPassed,
    };
  } catch (error) {
    keep = true;
    return erroredResult(runIndex, `the run did not finish: ${(error as Error).message}`, {
      agentModel,
      costUsd: 0,
      durationMs: Date.now() - startedAt,
      sandbox,
    });
  } finally {
    // An errored run keeps its sandbox whatever the flag said: the transcript of what went wrong
    // is in there and nowhere else.
    if (!keep) {
      removeSandbox(sandbox);
    }
  }
}
