import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';

import { hasMalformedPlaceholder } from './manifest';

/** The judge score a run needs unless the set or the case says otherwise. */
export const DEFAULT_THRESHOLD = 70;

export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/** Where a plugin keeps its skills: `plugins/<plugin>/skills/<skill>/`. */
export const PLUGINS_DIRECTORY = 'plugins';

/** Where a skill keeps its golden set, after the Agent Skills convention (`evals/evals.json`). */
export const EVALS_DIRECTORY = 'evals';
export const EVALS_FILE = 'evals.json';

export type AssertionSeverity = 'error' | 'warn';

/** A statement the judge grades PASS or FAIL with evidence. Only `error` ones fail a run. */
export type Assertion = { readonly text: string; readonly severity: AssertionSeverity };

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'any';

/**
 * The deterministic checks. Each is a fact about the sandbox after the run that a script decides,
 * never a model — the same way the ablation grades. `glob` is matched against repository-relative
 * paths of the files the agent changed; `golden` and the `files[].from` paths are relative to the
 * skill's `evals/` directory.
 */
export type Check =
  | { readonly type: 'skill-fired'; readonly skill: string; readonly expected: boolean }
  | {
      readonly type: 'files-changed';
      readonly glob: string;
      readonly status: ChangeStatus;
      readonly min: number;
      readonly max?: number;
    }
  | { readonly type: 'workflow-compiles'; readonly glob: string }
  | {
      readonly type: 'workflow-revision';
      readonly glob: string;
      readonly id: string;
      readonly version: number;
    }
  | { readonly type: 'compiled-graph-matches'; readonly glob: string; readonly golden: string }
  | {
      readonly type: 'answer-matches';
      readonly pattern: string;
      readonly flags: string;
      readonly expected: boolean;
    }
  | { readonly type: 'mcp-tool-called'; readonly tool: string; readonly min: number };

export type CheckType = Check['type'];

/** A file placed into the sandbox before the run: the input a case works on. */
export type InputFile = { readonly from: string; readonly to: string };

/**
 * How the skill reaches the agent. `explicit` sends the prompt as `/<skill> <prompt>`, so the case
 * measures what the skill's content produces — the Agent Skills guide's own pattern for output
 * evals, and the only one that means anything on a model that seldom routes to a skill by itself.
 * `natural` sends the prompt bare, so the case also measures whether the skill is reached for;
 * that is what `skills:routing` measures at scale, and what a case about *not* firing needs.
 */
export type Invocation = 'explicit' | 'natural';

export type GoldenCase = {
  readonly id: string;
  readonly prompt: string;
  readonly invocation: Invocation;
  /**
   * The agent model this case needs, when the default is not enough — an answer a cheaper model
   * gets wrong even with the skill in front of it. Unset means the command line's default.
   */
  readonly model?: string;
  /** What success looks like, for the judge — required core content, not wording. */
  readonly expectedOutput: string;
  /** A reference artifact or answer the judge sees beside the expected output. */
  readonly golden?: string;
  /**
   * The golden answer's text with its `{{manifest:…}}` placeholders replaced; set only for a case
   * whose golden answer has any, once a run has resolved them against the seed manifest.
   */
  readonly goldenContent?: string;
  readonly files: readonly InputFile[];
  readonly checks: readonly Check[];
  readonly assertions: readonly Assertion[];
  readonly threshold: number;
  /** `false` for a case the deterministic checks decide alone; the judge is then not called. */
  readonly judge: boolean;
};

/**
 * The MCP servers a set's runs may reach: the `--mcp-config` file, as an absolute path, and the
 * server names it declares, which are what `mcp__<server>__<tool>` tool calls are matched against.
 */
export type McpConfig = { readonly file: string; readonly servers: readonly string[] };

export type GoldenSet = {
  /** The skill's directory name, which is also its name inside a plugin. */
  readonly skill: string;
  /**
   * The plugin the skill ships in — the directory under `plugins/` — or unset for a skill under
   * `.claude/skills/`. A plugin skill is invoked as `<plugin>:<skill>` and reaches the headless run
   * through `--plugin-dir`, since nothing is installed in a sandbox.
   */
  readonly plugin?: string;
  /** Absolute path of the `evals/` directory. */
  readonly directory: string;
  readonly mcp?: McpConfig;
  readonly cases: readonly GoldenCase[];
};

export type GoldenSetProblem = { readonly at: string; readonly message: string };

const SET_KEYS = new Set(['skill_name', 'threshold', 'model', 'mcp_config', 'evals']);
const CASE_KEYS = new Set([
  'id',
  'prompt',
  'invocation',
  'model',
  'expected_output',
  'golden',
  'files',
  'checks',
  'assertions',
  'threshold',
  'judge',
]);
const CHECK_KEYS: Record<CheckType, ReadonlySet<string>> = {
  'skill-fired': new Set(['type', 'skill', 'expected']),
  'files-changed': new Set(['type', 'glob', 'status', 'min', 'max']),
  'workflow-compiles': new Set(['type', 'glob']),
  'workflow-revision': new Set(['type', 'glob', 'id', 'version']),
  'compiled-graph-matches': new Set(['type', 'glob', 'golden']),
  'answer-matches': new Set(['type', 'pattern', 'flags', 'expected']),
  'mcp-tool-called': new Set(['type', 'tool', 'min']),
};
const CHANGE_STATUSES: readonly ChangeStatus[] = ['added', 'modified', 'deleted', 'any'];
const INVOCATIONS: readonly Invocation[] = ['explicit', 'natural'];
const SEVERITIES: readonly AssertionSeverity[] = ['error', 'warn'];
const MALFORMED_PLACEHOLDER =
  'has a malformed {{manifest:…}} placeholder; write {{manifest:<scenario-key>}} or {{manifest:<scenario-key>.explanation}}';
const CASE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type Problems = GoldenSetProblem[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function reportUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  at: string,
  problems: Problems,
): void {
  // Unknown keys fail rather than warn: a misspelt `asertions` would silently grade nothing.
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      problems.push({
        at,
        message: `unknown key "${key}" (allowed: ${[...allowed].sort().join(', ')})`,
      });
    }
  }
}

/**
 * A path a case names must stay inside the directory it is relative to. `..` and absolute paths
 * are refused outright rather than resolved, because a golden set that reaches outside its own
 * `evals/` directory is a mistake whatever it resolves to.
 */
function isContainedRelativePath(value: string): boolean {
  if (isAbsolute(value)) {
    return false;
  }

  const normalized = normalize(value).replace(/\\/g, '/');

  return normalized !== '..' && !normalized.startsWith('../') && !normalized.startsWith('/');
}

/** A model name or alias, as `claude --model` takes it: one token, no whitespace. */
function readModel(
  value: unknown,
  fallback: string | undefined,
  at: string,
  problems: Problems,
): string | undefined {
  if (value === undefined) {
    return fallback;
  }

  if (!isNonEmptyString(value) || /\s/.test(value)) {
    problems.push({ at, message: 'must be a model name or alias without whitespace' });
    return fallback;
  }

  return value;
}

function readThreshold(value: unknown, fallback: number, at: string, problems: Problems): number {
  if (value === undefined) {
    return fallback;
  }

  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < SCORE_MIN ||
    value > SCORE_MAX
  ) {
    problems.push({
      at,
      message: `threshold must be an integer between ${SCORE_MIN} and ${SCORE_MAX}`,
    });
    return fallback;
  }

  return value;
}

function parseAssertion(value: unknown, at: string, problems: Problems): Assertion | undefined {
  if (isNonEmptyString(value)) {
    if (hasMalformedPlaceholder(value)) {
      problems.push({ at, message: MALFORMED_PLACEHOLDER });
    }

    return { text: value.trim(), severity: 'error' };
  }

  if (!isRecord(value)) {
    problems.push({ at, message: 'an assertion is a string or { text, severity }' });
    return undefined;
  }

  reportUnknownKeys(value, new Set(['text', 'severity']), at, problems);

  if (!isNonEmptyString(value.text)) {
    problems.push({ at: `${at}.text`, message: 'must be a non-empty string' });
    return undefined;
  }

  if (hasMalformedPlaceholder(value.text)) {
    problems.push({ at: `${at}.text`, message: MALFORMED_PLACEHOLDER });
  }

  const severity = value.severity ?? 'error';

  if (!SEVERITIES.includes(severity as AssertionSeverity)) {
    problems.push({ at: `${at}.severity`, message: `must be one of ${SEVERITIES.join(', ')}` });
    return undefined;
  }

  return { text: value.text.trim(), severity: severity as AssertionSeverity };
}

function parseInputFile(
  value: unknown,
  directory: string,
  at: string,
  problems: Problems,
): InputFile | undefined {
  if (!isRecord(value)) {
    problems.push({ at, message: 'an input file is { from, to }' });
    return undefined;
  }

  reportUnknownKeys(value, new Set(['from', 'to']), at, problems);

  const { from, to } = value;
  let valid = true;

  if (!isNonEmptyString(from) || !isContainedRelativePath(from)) {
    problems.push({
      at: `${at}.from`,
      message: 'must be a relative path inside the evals directory',
    });
    valid = false;
  } else if (!existsSync(join(directory, from)) || !statSync(join(directory, from)).isFile()) {
    problems.push({ at: `${at}.from`, message: `no such file: ${from}` });
    valid = false;
  }

  if (!isNonEmptyString(to) || !isContainedRelativePath(to)) {
    problems.push({ at: `${at}.to`, message: 'must be a relative path inside the repository' });
    valid = false;
  }

  return valid ? { from: from as string, to: to as string } : undefined;
}

function parseCheck(
  value: unknown,
  skill: string,
  directory: string,
  at: string,
  problems: Problems,
): Check | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.type)) {
    problems.push({ at, message: 'a check is an object with a "type"' });
    return undefined;
  }

  const type = value.type as CheckType;
  const allowed = CHECK_KEYS[type];

  if (allowed === undefined) {
    problems.push({
      at: `${at}.type`,
      message: `unknown check type "${value.type}" (known: ${Object.keys(CHECK_KEYS).join(', ')})`,
    });
    return undefined;
  }

  reportUnknownKeys(value, allowed, at, problems);

  const before = problems.length;
  const requireGlob = (): string => {
    if (!isNonEmptyString(value.glob)) {
      problems.push({ at: `${at}.glob`, message: 'must be a non-empty glob' });
      return '';
    }
    return value.glob;
  };
  const requireBoolean = (key: string, fallback: boolean): boolean => {
    if (value[key] === undefined) {
      return fallback;
    }
    if (typeof value[key] !== 'boolean') {
      problems.push({ at: `${at}.${key}`, message: 'must be a boolean' });
      return fallback;
    }
    return value[key] as boolean;
  };

  let check: Check | undefined;

  switch (type) {
    case 'skill-fired': {
      const target = value.skill ?? skill;
      if (!isNonEmptyString(target)) {
        problems.push({ at: `${at}.skill`, message: 'must be a skill name' });
      }
      check = { type, skill: String(target), expected: requireBoolean('expected', true) };
      break;
    }
    case 'files-changed': {
      const glob = requireGlob();
      const status = value.status ?? 'any';
      if (!CHANGE_STATUSES.includes(status as ChangeStatus)) {
        problems.push({
          at: `${at}.status`,
          message: `must be one of ${CHANGE_STATUSES.join(', ')}`,
        });
      }
      const min = value.min ?? 0;
      const max = value.max;
      if (typeof min !== 'number' || !Number.isInteger(min) || min < 0) {
        problems.push({ at: `${at}.min`, message: 'must be a non-negative integer' });
      }
      if (max !== undefined && (typeof max !== 'number' || !Number.isInteger(max) || max < 0)) {
        problems.push({ at: `${at}.max`, message: 'must be a non-negative integer' });
      }
      if (typeof min === 'number' && typeof max === 'number' && min > max) {
        problems.push({ at, message: 'min must not exceed max' });
      }
      if (min === 0 && max === undefined) {
        problems.push({
          at,
          message: 'a files-changed check with neither min nor max asserts nothing',
        });
      }
      check = {
        type,
        glob,
        status: status as ChangeStatus,
        min: min as number,
        ...(max === undefined ? {} : { max: max as number }),
      };
      break;
    }
    case 'workflow-compiles':
      check = { type, glob: requireGlob() };
      break;
    case 'workflow-revision': {
      const glob = requireGlob();
      if (!isNonEmptyString(value.id)) {
        problems.push({ at: `${at}.id`, message: 'must be a workflow id' });
      }
      if (
        typeof value.version !== 'number' ||
        !Number.isInteger(value.version) ||
        value.version < 1
      ) {
        problems.push({ at: `${at}.version`, message: 'must be a positive integer' });
      }
      check = { type, glob, id: String(value.id), version: Number(value.version) };
      break;
    }
    case 'compiled-graph-matches': {
      const glob = requireGlob();
      if (!isNonEmptyString(value.golden) || !isContainedRelativePath(value.golden)) {
        problems.push({
          at: `${at}.golden`,
          message: 'must be a relative path inside the evals directory',
        });
      } else if (!existsSync(join(directory, value.golden))) {
        problems.push({ at: `${at}.golden`, message: `no such file: ${value.golden}` });
      }
      check = { type, glob, golden: String(value.golden) };
      break;
    }
    case 'answer-matches': {
      const flags = value.flags ?? '';
      if (!isNonEmptyString(value.pattern)) {
        problems.push({ at: `${at}.pattern`, message: 'must be a non-empty regular expression' });
      } else if (typeof flags !== 'string') {
        problems.push({ at: `${at}.flags`, message: 'must be a string of RegExp flags' });
      } else {
        try {
          new RegExp(value.pattern, flags);
        } catch (error) {
          problems.push({
            at: `${at}.pattern`,
            message: `invalid RegExp: ${(error as Error).message}`,
          });
        }
      }
      check = {
        type,
        pattern: String(value.pattern),
        flags: typeof flags === 'string' ? flags : '',
        expected: requireBoolean('expected', true),
      };
      break;
    }
    case 'mcp-tool-called': {
      // The bare tool name, as the server declares it: the harness's `mcp__<server>__` prefix is
      // the set's `mcp_config` talking, and writing it here would pin the check to a server name.
      if (!isNonEmptyString(value.tool) || /\s/.test(value.tool)) {
        problems.push({ at: `${at}.tool`, message: 'must be an MCP tool name without whitespace' });
      } else if (value.tool.startsWith('mcp__')) {
        problems.push({
          at: `${at}.tool`,
          message:
            'must be the tool name alone; the "mcp__<server>__" prefix is added when matching',
        });
      }
      const min = value.min ?? 1;
      if (typeof min !== 'number' || !Number.isInteger(min) || min < 1) {
        problems.push({ at: `${at}.min`, message: 'must be a positive integer' });
      }
      check = { type, tool: String(value.tool), min: min as number };
      break;
    }
  }

  return problems.length === before ? check : undefined;
}

function parseCase(
  value: unknown,
  context: { skill: string; directory: string; threshold: number; model?: string },
  at: string,
  problems: Problems,
): GoldenCase | undefined {
  if (!isRecord(value)) {
    problems.push({ at, message: 'a case is an object' });
    return undefined;
  }

  reportUnknownKeys(value, CASE_KEYS, at, problems);

  const before = problems.length;

  if (!isNonEmptyString(value.id) || !CASE_ID_PATTERN.test(value.id)) {
    problems.push({ at: `${at}.id`, message: 'must be lowercase words joined by single hyphens' });
  }

  if (!isNonEmptyString(value.prompt)) {
    problems.push({ at: `${at}.prompt`, message: 'must be a non-empty string' });
  } else if (hasMalformedPlaceholder(value.prompt)) {
    problems.push({ at: `${at}.prompt`, message: MALFORMED_PLACEHOLDER });
  } else if (value.prompt.trimStart().startsWith('/')) {
    problems.push({
      at: `${at}.prompt`,
      message:
        'must not start with a slash; "invocation": "explicit" (the default) prefixes the skill',
    });
  }

  const invocation = value.invocation ?? 'explicit';

  if (!INVOCATIONS.includes(invocation as Invocation)) {
    problems.push({ at: `${at}.invocation`, message: `must be one of ${INVOCATIONS.join(', ')}` });
  }

  const judge = value.judge === undefined ? true : value.judge;

  if (typeof judge !== 'boolean') {
    problems.push({ at: `${at}.judge`, message: 'must be a boolean' });
  }

  // The expected output is what the judge grades against, so a judged case cannot do without it;
  // a case decided by its checks alone may still carry one as documentation.
  if (judge === true && !isNonEmptyString(value.expected_output)) {
    problems.push({
      at: `${at}.expected_output`,
      message: 'must be a non-empty string when the case is judged',
    });
  } else if (value.expected_output !== undefined && typeof value.expected_output !== 'string') {
    problems.push({ at: `${at}.expected_output`, message: 'must be a string' });
  }

  if (typeof value.expected_output === 'string' && hasMalformedPlaceholder(value.expected_output)) {
    problems.push({ at: `${at}.expected_output`, message: MALFORMED_PLACEHOLDER });
  }

  if (value.golden !== undefined) {
    if (!isNonEmptyString(value.golden) || !isContainedRelativePath(value.golden)) {
      problems.push({
        at: `${at}.golden`,
        message: 'must be a relative path inside the evals directory',
      });
    } else if (!existsSync(join(context.directory, value.golden))) {
      problems.push({ at: `${at}.golden`, message: `no such file: ${value.golden}` });
    }
  }

  const files: InputFile[] = [];

  if (value.files !== undefined) {
    if (!Array.isArray(value.files)) {
      problems.push({ at: `${at}.files`, message: 'must be a list of { from, to }' });
    } else {
      value.files.forEach((entry, index) => {
        const file = parseInputFile(entry, context.directory, `${at}.files[${index}]`, problems);
        if (file !== undefined) {
          files.push(file);
        }
      });
    }
  }

  const checks: Check[] = [];

  if (!Array.isArray(value.checks) || value.checks.length === 0) {
    problems.push({
      at: `${at}.checks`,
      message: 'must be a non-empty list; every case has at least one deterministic check',
    });
  } else {
    value.checks.forEach((entry, index) => {
      const check = parseCheck(
        entry,
        context.skill,
        context.directory,
        `${at}.checks[${index}]`,
        problems,
      );
      if (check !== undefined) {
        checks.push(check);
      }
    });
  }

  const assertions: Assertion[] = [];

  if (value.assertions !== undefined) {
    if (!Array.isArray(value.assertions)) {
      problems.push({ at: `${at}.assertions`, message: 'must be a list' });
    } else {
      value.assertions.forEach((entry, index) => {
        const assertion = parseAssertion(entry, `${at}.assertions[${index}]`, problems);
        if (assertion !== undefined) {
          assertions.push(assertion);
        }
      });
    }
  }

  if (judge === false && assertions.length > 0) {
    problems.push({
      at: `${at}.assertions`,
      message: 'assertions are graded by the judge, which this case disables',
    });
  }

  const threshold = readThreshold(value.threshold, context.threshold, `${at}.threshold`, problems);
  const model = readModel(value.model, context.model, `${at}.model`, problems);

  if (problems.length !== before) {
    return undefined;
  }

  return {
    id: value.id as string,
    prompt: (value.prompt as string).trim(),
    invocation: invocation as Invocation,
    ...(model === undefined ? {} : { model }),
    expectedOutput: typeof value.expected_output === 'string' ? value.expected_output.trim() : '',
    ...(value.golden === undefined ? {} : { golden: value.golden as string }),
    files,
    checks,
    assertions,
    threshold,
    judge: judge as boolean,
  };
}

/** How a set is named in a problem: the skill alone for a repository skill, its path in a plugin. */
function setLocation(context: { skill: string; plugin?: string }): string {
  return context.plugin === undefined
    ? context.skill
    : `${PLUGINS_DIRECTORY}/${context.plugin}/skills/${context.skill}`;
}

/**
 * Resolves and reads a set's `mcp_config`: a path relative to the set's `evals/` directory or, when
 * nothing is there, to the repository root — a plugin's own `.mcp.json` is the common case, and it
 * sits outside `evals/`. The file is the one `claude --mcp-config` reads, `{ "mcpServers": { ... } }`,
 * so a document without that key is refused here rather than run with no servers at all.
 */
function readMcpConfig(
  value: unknown,
  context: { directory: string; repoRoot: string },
  at: string,
  problems: Problems,
): McpConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isNonEmptyString(value) || !isContainedRelativePath(value)) {
    problems.push({
      at,
      message: 'must be a relative path inside the evals directory or the repository',
    });
    return undefined;
  }

  const file = [join(context.directory, value), join(context.repoRoot, value)].find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );

  if (file === undefined) {
    problems.push({
      at,
      message: `no such file: ${value} (looked in the evals directory and the repository root)`,
    });
    return undefined;
  }

  let document: unknown;

  try {
    document = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    problems.push({ at, message: `${value}: unparseable JSON: ${(error as Error).message}` });
    return undefined;
  }

  if (!isRecord(document) || !isRecord(document.mcpServers)) {
    problems.push({
      at,
      message: `${value} must be { "mcpServers": { "<name>": { ... } } }, the form claude --mcp-config reads`,
    });
    return undefined;
  }

  const servers = Object.keys(document.mcpServers);

  if (servers.length === 0) {
    problems.push({ at, message: `${value} declares no MCP server` });
    return undefined;
  }

  return { file, servers };
}

/** Parses one `evals.json`, already read and JSON-decoded. Problems are reported, never thrown. */
export function parseGoldenSet(
  raw: unknown,
  context: { skill: string; directory: string; repoRoot: string; plugin?: string },
): { set?: GoldenSet; problems: GoldenSetProblem[] } {
  const problems: Problems = [];
  const at = `${setLocation(context)}/${EVALS_DIRECTORY}/${EVALS_FILE}`;

  if (!isRecord(raw)) {
    return { problems: [{ at, message: 'must be a JSON object' }] };
  }

  reportUnknownKeys(raw, SET_KEYS, at, problems);

  if (raw.skill_name !== context.skill) {
    problems.push({
      at: `${at}.skill_name`,
      message: `must be "${context.skill}", the skill directory this file sits in`,
    });
  }

  const threshold = readThreshold(raw.threshold, DEFAULT_THRESHOLD, `${at}.threshold`, problems);
  const mcp = readMcpConfig(raw.mcp_config, context, `${at}.mcp_config`, problems);
  // A set-level model is the default for its cases, the way a set-level threshold is.
  const model = readModel(raw.model, undefined, `${at}.model`, problems);
  const cases: GoldenCase[] = [];

  if (!Array.isArray(raw.evals) || raw.evals.length === 0) {
    problems.push({ at: `${at}.evals`, message: 'must be a non-empty list of cases' });
  } else {
    const seen = new Map<string, number>();

    raw.evals.forEach((entry, index) => {
      const parsed = parseCase(
        entry,
        { skill: context.skill, directory: context.directory, threshold, model },
        `${at}.evals[${index}]`,
        problems,
      );

      if (parsed === undefined) {
        return;
      }

      const first = seen.get(parsed.id);

      if (first !== undefined) {
        problems.push({
          at: `${at}.evals[${index}].id`,
          message: `duplicates evals[${first}].id "${parsed.id}"`,
        });
        return;
      }

      seen.set(parsed.id, index);
      cases.push(parsed);
    });
  }

  if (problems.length > 0) {
    return { problems };
  }

  return {
    set: {
      skill: context.skill,
      ...(context.plugin === undefined ? {} : { plugin: context.plugin }),
      directory: context.directory,
      ...(mcp === undefined ? {} : { mcp }),
      cases,
    },
    problems,
  };
}

export type LoadedGoldenSets = {
  readonly sets: readonly GoldenSet[];
  readonly problems: readonly GoldenSetProblem[];
  /**
   * Skills that ship no golden set — reported, not failed. A plugin skill is named
   * `<plugin>:<skill>`, the way it is invoked.
   */
  readonly skillsWithoutEvals: readonly string[];
};

/** The child directories of a directory, sorted, or none when it is absent. */
function listDirectoryNames(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Every skill a repository holds: under `.claude/skills/`, then under `plugins/<plugin>/skills/`. */
function listSkills(repoRoot: string): { skill: string; plugin?: string; directory: string }[] {
  const repositorySkills = join(repoRoot, '.claude', 'skills');
  const pluginsRoot = join(repoRoot, PLUGINS_DIRECTORY);

  return [
    ...listDirectoryNames(repositorySkills).map((skill) => ({
      skill,
      directory: join(repositorySkills, skill),
    })),
    ...listDirectoryNames(pluginsRoot).flatMap((plugin) =>
      listDirectoryNames(join(pluginsRoot, plugin, 'skills')).map((skill) => ({
        skill,
        plugin,
        directory: join(pluginsRoot, plugin, 'skills', skill),
      })),
    ),
  ];
}

/**
 * Reads every skill's golden set from `.claude/skills/<skill>/evals/evals.json` and from
 * `plugins/<plugin>/skills/<skill>/evals/evals.json`.
 */
export function loadGoldenSets(repoRoot: string): LoadedGoldenSets {
  const sets: GoldenSet[] = [];
  const problems: GoldenSetProblem[] = [];
  const skillsWithoutEvals: string[] = [];

  for (const { skill, plugin, directory: skillDirectory } of listSkills(repoRoot)) {
    const location = setLocation({ skill, plugin });
    const directory = join(skillDirectory, EVALS_DIRECTORY);
    const file = join(directory, EVALS_FILE);

    if (!existsSync(file)) {
      skillsWithoutEvals.push(plugin === undefined ? skill : `${plugin}:${skill}`);
      continue;
    }

    let raw: unknown;

    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      problems.push({
        at: `${location}/${EVALS_DIRECTORY}/${EVALS_FILE}`,
        message: `unparseable JSON: ${(error as Error).message}`,
      });
      continue;
    }

    const parsed = parseGoldenSet(raw, { skill, directory, repoRoot, plugin });

    problems.push(...parsed.problems);

    if (parsed.set !== undefined) {
      sets.push(parsed.set);
    }
  }

  return { sets, problems, skillsWithoutEvals };
}
