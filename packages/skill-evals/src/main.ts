#!/usr/bin/env node

/**
 * `pnpm skills:evals` — golden-set evaluation of the skills under `.claude/skills/`.
 *
 * Every case is a prompt a person would type, an expected output a human wrote, deterministic
 * checks on the sandbox the agent worked in, and assertions a judge grades with evidence. The agent
 * is headless Claude Code with the skill installed — the thing that actually consumes a SKILL.md —
 * and the judge is one tool-less Claude call. Both spend money, so the whole command lives in its
 * own CI workflow rather than in the required pipeline; `--validate` is the free part and runs in
 * the unit tests too.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { join, resolve } from 'node:path';

import { type Ddl, loadDdl } from './checks';
import { type CliOptions, parseArgs, usage } from './cli';
import {
  type RunOptions,
  type RunResult,
  buildAgentPrompt,
  evaluateCase,
  resolveAgentModel,
} from './evaluate';
import {
  type GoldenCase,
  type GoldenSet,
  type GoldenSetProblem,
  loadGoldenSets,
} from './golden-set';
import {
  type CaseResult,
  type EvalReport,
  type InFlightRun,
  buildReport,
  renderConsoleLine,
  renderFailureLines,
  renderHeartbeat,
  renderMarkdown,
  renderStartLine,
  renderSummaryLine,
  summarizeCase,
  writeReport,
  writeStepSummary,
} from './report';
import {
  REPO_ROOT,
  abortActiveRuns,
  describeEnvironment,
  ensureOracleBuild,
  formatUsd,
} from './runner';

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
/** The shell's convention for a process ended by a signal: this plus the signal's number. */
const EXIT_SIGNAL_OFFSET = 128;

const MILLISECONDS_PER_MINUTE = 60_000;
const JUDGE_TIMEOUT_MS = 3 * MILLISECONDS_PER_MINUTE;
const HEARTBEAT_MS = MILLISECONDS_PER_MINUTE;

/** Ctrl+C in a terminal, and what CI sends a step it cancels. */
const STOP_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

type Selected = { readonly set: GoldenSet; readonly testCase: GoldenCase };

function selectCases(sets: readonly GoldenSet[], options: CliOptions): Selected[] | string {
  const known = new Set(sets.map((set) => set.skill));
  const unknown = options.skills.filter((skill) => !known.has(skill));

  if (unknown.length > 0) {
    return `no golden set for skill(s): ${unknown.join(', ')} (have: ${[...known].join(', ') || 'none'})`;
  }

  const selected = sets
    .filter((set) => options.skills.length === 0 || options.skills.includes(set.skill))
    .flatMap((set) =>
      set.cases
        .filter(
          (testCase) =>
            options.caseFilter === undefined || testCase.id.includes(options.caseFilter),
        )
        .map((testCase) => ({
          set,
          testCase:
            options.threshold === undefined
              ? testCase
              : { ...testCase, threshold: options.threshold },
        })),
    );

  return selected.length === 0 ? 'no case matches the filters' : selected;
}

/**
 * A golden artifact that does not compile would fail every run of its case for a reason that has
 * nothing to do with the skill. Checked here, without a model, and by the unit tests.
 */
export function validateGoldenArtifacts(sets: readonly GoldenSet[], ddl: Ddl): GoldenSetProblem[] {
  const problems: GoldenSetProblem[] = [];

  for (const set of sets) {
    for (const testCase of set.cases) {
      const goldens = new Set<string>();

      if (testCase.golden?.endsWith('.json')) {
        goldens.add(testCase.golden);
      }

      for (const check of testCase.checks) {
        if (check.type === 'compiled-graph-matches') {
          goldens.add(check.golden);
        }
      }

      for (const golden of goldens) {
        const at = `${set.skill}/${testCase.id}: ${golden}`;

        try {
          const document = JSON.parse(readFileSync(join(set.directory, golden), 'utf8'));

          ddl.compileWorkflowReport(document);
          ddl.validateAndNormalizeWorkflow(document);
        } catch (error) {
          const detail = error as Error & { reason?: string; path?: string };

          problems.push({
            at,
            message:
              detail.reason === undefined
                ? detail.message
                : `WORKFLOW_INVALID ${detail.reason}${detail.path === undefined ? '' : ` at ${detail.path}`}`,
          });
        }
      }
    }
  }

  return problems;
}

function printProblems(problems: readonly GoldenSetProblem[]): void {
  for (const problem of problems) {
    console.error(`FAIL  ${problem.at}  ${problem.message}`);
  }
}

function claudeVersion(): string | undefined {
  try {
    return execFileSync('claude', ['--version'], { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return undefined;
  }
}

async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];

      next += 1;
      await worker(item);
    }
  });

  await Promise.all(lanes);
}

function defaultReportDirectory(now: Date): string {
  return resolve(__dirname, '..', 'reports', now.toISOString().replace(/[:.]/g, '-'));
}

/** The finished cases in the order they were planned; a case still running has no entry yet. */
function orderResults(selected: readonly Selected[], results: readonly CaseResult[]): CaseResult[] {
  return selected.flatMap(({ set, testCase }) => {
    const entry = results.find(
      (candidate) => candidate.skill === set.skill && candidate.id === testCase.id,
    );

    return entry === undefined ? [] : [entry];
  });
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2), process.env);

  if ('error' in parsed) {
    console.error(`${parsed.error}\n\n${usage()}`);
    return EXIT_USAGE;
  }

  const options = parsed.options;

  if (options.help) {
    console.log(usage());
    return EXIT_OK;
  }

  const loaded = loadGoldenSets(REPO_ROOT);

  if (loaded.problems.length > 0) {
    printProblems(loaded.problems);
    console.error(`\n${loaded.problems.length} problem(s) in the golden sets.`);
    return EXIT_USAGE;
  }

  if (loaded.skillsWithoutEvals.length > 0) {
    console.log(`No golden set for: ${loaded.skillsWithoutEvals.join(', ')}.`);
  }

  if (options.validate) {
    ensureOracleBuild();

    const problems = validateGoldenArtifacts(loaded.sets, loadDdl());

    printProblems(problems);

    for (const set of loaded.sets) {
      console.log(`ok    ${set.skill}  ${set.cases.length} case(s)`);
    }

    console.log(`\n${loaded.sets.length} golden set(s), ${problems.length} problem(s).`);
    return problems.length === 0 ? EXIT_OK : EXIT_USAGE;
  }

  const selected = selectCases(loaded.sets, options);

  if (typeof selected === 'string') {
    console.error(selected);
    return EXIT_USAGE;
  }

  const agentSummary =
    options.overrideModel !== undefined
      ? `${options.overrideModel} (overriding the golden sets)`
      : `${options.agentModel} unless a case declares its own`;

  console.log(
    `${selected.length} case(s) x ${options.runs} run(s) on ${agentSummary}, judged by ${options.judgeModel}, via ${describeEnvironment()}.`,
  );

  if (options.dryRun) {
    for (const { set, testCase } of selected) {
      console.log(
        `\n${set.skill}/${testCase.id}  (${resolveAgentModel(testCase, options)}, ${testCase.invocation} invocation, threshold ${testCase.threshold}, ${testCase.checks.length} check(s), ${testCase.assertions.length} assertion(s)${testCase.judge ? '' : ', not judged'})\n  ${buildAgentPrompt(set, testCase)}`,
      );
    }

    console.log(
      `\nDry run: nothing was spent. Caps: ${formatUsd(options.maxBudgetUsd)} per agent run, ${formatUsd(options.judgeMaxBudgetUsd)} per judge call, ${options.timeoutMinutes} min per run.`,
    );
    return EXIT_OK;
  }

  const version = claudeVersion();

  if (version === undefined) {
    console.error(
      'The `claude` command is not available. Install Claude Code (npm i -g @anthropic-ai/claude-code) and sign in, or set ANTHROPIC_API_KEY.',
    );
    return EXIT_USAGE;
  }

  ensureOracleBuild();

  const ddl = loadDdl();
  const runOptions: RunOptions = {
    agentModel: options.agentModel,
    ...(options.overrideModel === undefined ? {} : { overrideModel: options.overrideModel }),
    judgeModel: options.judgeModel,
    maxBudgetUsd: options.maxBudgetUsd,
    judgeMaxBudgetUsd: options.judgeMaxBudgetUsd,
    timeoutMs: options.timeoutMinutes * MILLISECONDS_PER_MINUTE,
    judgeTimeoutMs: JUDGE_TIMEOUT_MS,
    keepSandbox: options.keepSandbox,
    ddl: () => ddl,
  };
  const reportDirectory = options.reportDir ?? defaultReportDirectory(new Date());
  const results: CaseResult[] = [];
  const inFlight = new Map<string, InFlightRun>();

  // Rewritten after every finished case and once more on the way out, so a run that is killed or
  // interrupted still leaves what it measured — marked partial, with the runs it was waiting on.
  // On GitHub the same Markdown goes to the step's summary page each time, which is the whole UI
  // this suite has there once the job is gone.
  const writeCurrentReport = (interrupted: readonly string[]) => {
    const report = buildReport(orderResults(selected, results), {
      agentModel: options.overrideModel ?? options.agentModel,
      judgeModel: options.judgeModel,
      runsPerCase: options.runs,
      minPassRate: options.minPassRate,
      environment: describeEnvironment(),
      plannedCases: selected.length,
      interrupted,
    });
    const written = writeReport(reportDirectory, report);

    if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
      writeStepSummary(process.env.GITHUB_STEP_SUMMARY, report);
    }

    return { report, written };
  };

  // The report as the console's last word, when asked: a CI log is read where it ends, and the
  // report files do not outlive the job.
  const printReport = (report: EvalReport) => {
    if (options.printReport) {
      console.log(`\n${renderMarkdown(report)}`);
    }
  };

  // A case takes minutes and the agents keep spending until they are told to stop, so a stop
  // signal ends them, removes their sandboxes and leaves the partial report before exiting.
  const stopOnSignal = (signal: NodeJS.Signals): void => {
    const running = [...inFlight.values()].map((run) => run.name);

    console.log(
      `\n${signal}: stopping ${running.length} run(s) in flight${options.keepSandbox ? '' : ' and removing their sandboxes'}.`,
    );

    const aborted = abortActiveRuns({ keepSandboxes: options.keepSandbox });
    const { report, written } = writeCurrentReport(running);

    console.log(renderSummaryLine(report));

    for (const sandbox of aborted.sandboxesLeft) {
      console.log(`Sandbox left at ${sandbox}`);
    }

    console.log(`Report: ${written.markdown}`);
    printReport(report);
    process.exit(EXIT_SIGNAL_OFFSET + osConstants.signals[signal]);
  };

  // Kept until the process exits: a signal during the final report write must still end it.
  for (const signal of STOP_SIGNALS) {
    process.on(signal, stopOnSignal);
  }

  const heartbeat = setInterval(() => {
    if (inFlight.size > 0) {
      console.log(renderHeartbeat([...inFlight.values()], Date.now()));
    }
  }, HEARTBEAT_MS);

  heartbeat.unref();

  console.log(
    `Claude Code ${version}. Running ${Math.min(options.concurrency, selected.length)} case(s) at a time.\n`,
  );

  await runPool(selected, options.concurrency, async ({ set, testCase }) => {
    const name = `${set.skill}/${testCase.id}`;
    const agentModel = resolveAgentModel(testCase, runOptions);
    const runs: RunResult[] = [];

    for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
      console.log(renderStartLine(name, runIndex, options.runs, agentModel));
      inFlight.set(name, { name, agentModel, startedAt: Date.now() });

      try {
        runs.push(await evaluateCase(set, testCase, runIndex, runOptions));
      } finally {
        inFlight.delete(name);
      }
    }

    const summary = summarizeCase(set, testCase, runs, options.minPassRate);

    results.push(summary);
    // A failed case says why on the spot, so a sweep read from the console is not a list of red
    // names with the reasons in a file.
    console.log([renderConsoleLine(summary), ...renderFailureLines(summary)].join('\n'));
    writeCurrentReport([]);
  });

  clearInterval(heartbeat);

  const { report, written } = writeCurrentReport([]);

  console.log(`\n${renderSummaryLine(report)}`);
  console.log(`Report: ${written.markdown}`);
  printReport(report);

  return report.totals.passedCases === report.totals.cases ? EXIT_OK : EXIT_FAILED;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error: Error) => {
      console.error(error.message);
      process.exit(EXIT_USAGE);
    });
}
