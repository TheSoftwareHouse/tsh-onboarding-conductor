/** The command line, parsed. Defaults are here and in `usage()` and nowhere else. */
export type CliOptions = {
  readonly skills: readonly string[];
  readonly caseFilter?: string;
  readonly runs: number;
  /** The agent model for cases that declare none. */
  readonly agentModel: string;
  /** The agent model for every case, whatever it declares. */
  readonly overrideModel?: string;
  readonly judgeModel: string;
  readonly threshold?: number;
  readonly minPassRate: number;
  readonly maxBudgetUsd: number;
  readonly judgeMaxBudgetUsd: number;
  readonly timeoutMinutes: number;
  readonly concurrency: number;
  readonly reportDir?: string;
  /** Print the whole Markdown report to stdout when the run ends, for a CI log. */
  readonly printReport: boolean;
  readonly keepSandbox: boolean;
  readonly dryRun: boolean;
  readonly validate: boolean;
  readonly help: boolean;
};

export const AGENT_MODEL_ENV = 'SKILL_EVALS_AGENT_MODEL';
export const JUDGE_MODEL_ENV = 'SKILL_EVALS_JUDGE_MODEL';

/**
 * `haiku` for both. The agent default is what the CI bill is decided on — a session-grade model
 * costs three to five times more per run — and `--model` overrides it whenever a result on the
 * model sessions actually use is wanted. The judge stays on the cheapest model: one call, a few
 * thousand tokens, and the objective checks are decided by scripts rather than by it.
 */
export const DEFAULTS = {
  runs: 1,
  agentModel: 'haiku',
  judgeModel: 'haiku',
  minPassRate: 0.5,
  maxBudgetUsd: 2,
  judgeMaxBudgetUsd: 0.25,
  timeoutMinutes: 15,
  concurrency: 2,
} as const;

export function usage(): string {
  return [
    'Usage: pnpm skills:evals [options]',
    '',
    'Runs every golden-set case under .claude/skills/<skill>/evals/evals.json through headless',
    'Claude Code, grades the sandbox with the repository oracles and a Claude judge, and writes a',
    'report. Exit code 0 when every case passes.',
    '',
    'Options:',
    '  --skill <name>            only this skill (repeatable)',
    '  --case <text>             only cases whose id contains the text',
    `  --runs <n>                runs per case (default ${DEFAULTS.runs})`,
    `  --model <model>           agent model for cases that declare none (default ${DEFAULTS.agentModel}, or $${AGENT_MODEL_ENV})`,
    '  --override-model <model>  agent model for every case, ignoring what the golden sets declare',
    `  --judge-model <model>     judge model (default ${DEFAULTS.judgeModel}, or $${JUDGE_MODEL_ENV})`,
    '  --threshold <0-100>       judge score every case must reach, overriding the golden sets',
    `  --pass-rate <0-1>         share of graded runs a case needs (default ${DEFAULTS.minPassRate})`,
    `  --max-budget-usd <n>      cap per agent run (default ${DEFAULTS.maxBudgetUsd})`,
    `  --judge-max-budget-usd <n> cap per judge call (default ${DEFAULTS.judgeMaxBudgetUsd})`,
    `  --timeout-minutes <n>     cap per agent run (default ${DEFAULTS.timeoutMinutes})`,
    `  --concurrency <n>         cases run at once (default ${DEFAULTS.concurrency})`,
    '  --report-dir <path>       where report.json and report.md go (default reports/<timestamp>)',
    '  --print-report            also print the whole Markdown report to stdout when the run ends',
    '  --keep-sandbox            leave every sandbox in place for inspection',
    '  --dry-run                 print the plan and spend nothing',
    '  --validate                check the golden sets and their artifacts without a model, then exit',
    '  --help                    this text',
  ].join('\n');
}

type ParseOutcome = { readonly options: CliOptions } | { readonly error: string };

function parseNumber(
  flag: string,
  raw: string | undefined,
  predicate: (value: number) => boolean,
  expectation: string,
): number | string {
  const value = raw === undefined ? Number.NaN : Number(raw);

  return Number.isFinite(value) && predicate(value) ? value : `${flag} takes ${expectation}`;
}

export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv): ParseOutcome {
  const skills: string[] = [];
  const draft: {
    -readonly [K in keyof CliOptions]: CliOptions[K];
  } = {
    skills,
    runs: DEFAULTS.runs,
    agentModel: env[AGENT_MODEL_ENV] ?? DEFAULTS.agentModel,
    judgeModel: env[JUDGE_MODEL_ENV] ?? DEFAULTS.judgeModel,
    minPassRate: DEFAULTS.minPassRate,
    maxBudgetUsd: DEFAULTS.maxBudgetUsd,
    judgeMaxBudgetUsd: DEFAULTS.judgeMaxBudgetUsd,
    timeoutMinutes: DEFAULTS.timeoutMinutes,
    concurrency: DEFAULTS.concurrency,
    printReport: false,
    keepSandbox: false,
    dryRun: false,
    validate: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];
    const takeValue = (): string | undefined => {
      index += 1;
      return next;
    };
    let parsed: number | string;

    switch (flag) {
      case '--skill': {
        const value = takeValue();
        if (value === undefined || value.startsWith('--')) {
          return { error: '--skill takes a skill name' };
        }
        skills.push(value);
        break;
      }
      case '--case': {
        const value = takeValue();
        if (value === undefined || value.startsWith('--')) {
          return { error: '--case takes part of a case id' };
        }
        draft.caseFilter = value;
        break;
      }
      case '--runs':
        parsed = parseNumber(
          flag,
          takeValue(),
          (v) => Number.isInteger(v) && v >= 1,
          'a positive integer',
        );
        if (typeof parsed === 'string') return { error: parsed };
        draft.runs = parsed;
        break;
      case '--model': {
        const value = takeValue();
        if (value === undefined || value.startsWith('--')) {
          return { error: '--model takes a model name or alias' };
        }
        draft.agentModel = value;
        break;
      }
      case '--override-model': {
        const value = takeValue();
        if (value === undefined || value.startsWith('--')) {
          return { error: '--override-model takes a model name or alias' };
        }
        draft.overrideModel = value;
        break;
      }
      case '--judge-model': {
        const value = takeValue();
        if (value === undefined || value.startsWith('--')) {
          return { error: '--judge-model takes a model name or alias' };
        }
        draft.judgeModel = value;
        break;
      }
      case '--threshold':
        parsed = parseNumber(
          flag,
          takeValue(),
          (v) => Number.isInteger(v) && v >= 0 && v <= 100,
          'an integer from 0 to 100',
        );
        if (typeof parsed === 'string') return { error: parsed };
        draft.threshold = parsed;
        break;
      case '--pass-rate':
        parsed = parseNumber(
          flag,
          takeValue(),
          (v) => v > 0 && v <= 1,
          'a number above 0 and up to 1',
        );
        if (typeof parsed === 'string') return { error: parsed };
        draft.minPassRate = parsed;
        break;
      case '--max-budget-usd':
        parsed = parseNumber(flag, takeValue(), (v) => v > 0, 'a positive amount');
        if (typeof parsed === 'string') return { error: parsed };
        draft.maxBudgetUsd = parsed;
        break;
      case '--judge-max-budget-usd':
        parsed = parseNumber(flag, takeValue(), (v) => v > 0, 'a positive amount');
        if (typeof parsed === 'string') return { error: parsed };
        draft.judgeMaxBudgetUsd = parsed;
        break;
      case '--timeout-minutes':
        parsed = parseNumber(flag, takeValue(), (v) => v > 0, 'a positive number of minutes');
        if (typeof parsed === 'string') return { error: parsed };
        draft.timeoutMinutes = parsed;
        break;
      case '--concurrency':
        parsed = parseNumber(
          flag,
          takeValue(),
          (v) => Number.isInteger(v) && v >= 1,
          'a positive integer',
        );
        if (typeof parsed === 'string') return { error: parsed };
        draft.concurrency = parsed;
        break;
      case '--report-dir': {
        const value = takeValue();
        if (value === undefined || value.startsWith('--')) {
          return { error: '--report-dir takes a path' };
        }
        draft.reportDir = value;
        break;
      }
      case '--print-report':
        draft.printReport = true;
        break;
      case '--keep-sandbox':
        draft.keepSandbox = true;
        break;
      case '--dry-run':
        draft.dryRun = true;
        break;
      case '--validate':
        draft.validate = true;
        break;
      case '--help':
      case '-h':
        draft.help = true;
        break;
      default:
        return { error: `unknown option ${flag}` };
    }
  }

  return { options: draft };
}
