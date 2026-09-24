#!/usr/bin/env node

/**
 * Measures whether a skill earns the context it costs.
 *
 * Every case below runs twice on the same prompt in two throwaway copies of this repository: once
 * with the skill in place, once with its directory deleted. Both copies keep `CLAUDE.md`,
 * `.claude/rules/` and `docs/` — deleting those too would measure the whole context setup and make
 * every skill look indispensable. What is graded is the artifact, not the transcript, and it is
 * graded by this repository's own oracles: `validate-workflows.cjs` and `compile-workflow.cjs`
 * decide whether a workflow is correct, the same way the engine decides it at startup. No model
 * judges anything here.
 *
 * The number that matters is the difference between the arms. A case both arms pass proves the
 * skill changed nothing on that case; a case both arms fail is a case that is too hard, or a rule
 * the skill states and does not manage to land. Cases are therefore chosen where the skill's own
 * MUST/NEVER table predicts the largest gap, not to be representative of ordinary work.
 *
 * This is slow and it spends real money — a full sweep is 24 agent runs. It never belongs in CI,
 * where it would attach a spend surface to every pull request and flake as a required check. Run it
 * when a skill is written, when its rules change substantially, when `docs/` grows a section the
 * skill duplicates, and before moving a skill into a shared plugin. The sweep is printed and not
 * stored: nothing here reads a previous run, so a committed report would be an artifact with no
 * reader. Redirect the output if one sweep is worth keeping.
 *
 * Usage:
 *   pnpm skills:ablation                      # every case, both arms
 *   pnpm skills:ablation --case version       # one case
 *   pnpm skills:ablation --runs 1             # a smoke test rather than a measurement
 *   pnpm skills:ablation --model opus         # the model your sessions actually run on
 *   pnpm skills:ablation --dry-run            # print the plan and spend nothing
 */

const { readFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const {
  collectChangedFiles,
  createSandbox,
  describeEnvironment,
  describeRunFailure,
  ensureOracleBuild,
  formatUsd,
  removeSandbox,
  runClaude,
  runOracle,
} = require('./skill-eval-runner.cjs');

// ---------------------------------------------------------------------------------------------
// Defaults. Edit these rather than prefixing the command with environment variables.
// ---------------------------------------------------------------------------------------------

/** The model under test. Use the one your sessions actually run on; the delta is model-specific. */
const MODEL = 'sonnet';

/** Per case, per arm. Three is the fewest that distinguishes a real gap from one lucky run. */
const RUNS = 3;

/** Per run. A case that has not finished by here has gone wrong, not slow. */
const MAX_BUDGET_USD = 4;

/** Per run. Long enough for a full authoring task including a compile and a validate. */
const TIMEOUT_MS = 20 * 60 * 1000;

/**
 * The cases.
 *
 * Each one targets a rule the skill states and a model would plausibly get wrong unaided — that is
 * what makes a delta visible. A case whose rule any competent model follows anyway measures
 * nothing, however important the rule is.
 *
 * `grade` is handed the sandbox and the oracles and returns `{ passed, detail }`. It must never ask
 * a model anything: the whole point is that the verdict is reproducible and arguable.
 */
const CASES = [
  {
    name: 'publish-new-version',
    skill: 'creating-workflows',
    prompt:
      "The EEA individual KYC flow (workflows/built-in) asks for the applicant's email before the OTP step. " +
      'Product wants that screen to also collect a mobile number. Make the change.',
    rule: 'A stored revision is never edited. Publish by adding a file with the same id and a higher version.',
    grade: ({ changedFiles, sandbox }) => {
      const existing = changedFiles.filter(
        (file) => file.path.startsWith('workflows/built-in/') && file.status !== '??',
      );
      const added = changedFiles.filter(
        (file) => file.path.startsWith('workflows/built-in/') && file.status === '??',
      );

      if (existing.length > 0) {
        return {
          passed: false,
          detail: `edited a stored revision: ${existing.map((f) => f.path).join(', ')}`,
        };
      }

      if (added.length === 0) {
        return { passed: false, detail: 'no new workflow file was published' };
      }

      const versions = added.map((file) => readJson(sandbox, file.path)?.version);

      return {
        passed: versions.some((version) => typeof version === 'number' && version > 2),
        detail: `published ${added.map((f) => f.path).join(', ')} at version ${versions.join(', ')}`,
      };
    },
  },
  {
    name: 'fixture-pair',
    skill: 'creating-workflows',
    prompt:
      'Add a fixture workflow under workflows/fixtures that demonstrates a risk-score step routing to ' +
      'three different outcomes. Call it mock-risk-routing.',
    rule: 'A fixture ships as a pair: <id>.workflow.json in custom steps and <id>-typed.workflow.json with none.',
    grade: ({ changedFiles }) => {
      const added = changedFiles
        .filter((file) => file.status === '??' && file.path.startsWith('workflows/fixtures/'))
        .map((file) => file.path);

      const untyped = added.filter((path) => !path.endsWith('-typed.workflow.json'));
      const typed = added.filter((path) => path.endsWith('-typed.workflow.json'));

      return {
        passed: untyped.length === 1 && typed.length === 1,
        detail: added.length === 0 ? 'added nothing' : `added ${added.join(', ')}`,
      };
    },
  },
  {
    name: 'retry-error-handler',
    skill: 'creating-workflows',
    prompt:
      'Add a fixture workflow under workflows/fixtures called mock-retrying-callout with a single HTTP ' +
      'request step that retries up to three times before it gives up.',
    rule: 'retry without errorHandler is a silent no-op; a binding that retries names retry_then_fallback.',
    grade: ({ changedFiles, sandbox }) => {
      const added = changedFiles.filter(
        (file) =>
          file.status === '??' &&
          file.path.startsWith('workflows/fixtures/') &&
          !file.path.endsWith('-typed.workflow.json'),
      );

      if (added.length === 0) {
        return { passed: false, detail: 'added nothing' };
      }

      const document = JSON.stringify(readJson(sandbox, added[0].path) ?? {});
      const declaresRetry = document.includes('"retry"');
      const declaresHandler = document.includes('retry_then_fallback');

      return {
        passed: declaresRetry && declaresHandler,
        detail: `${added[0].path}: retry=${declaresRetry}, errorHandler=${declaresHandler}`,
      };
    },
  },
  {
    name: 'wire-every-port',
    skill: 'creating-workflows',
    prompt:
      'Add a fixture workflow under workflows/fixtures called mock-branching-intake: it collects a country, ' +
      'branches on whether that country is in the EEA, and ends in a different terminal on each branch.',
    rule: 'Every non-optional port of every step is wired, and the document compiles and validates.',
    grade: ({ changedFiles, sandbox }) => {
      const added = changedFiles.filter(
        (file) =>
          file.status === '??' &&
          file.path.startsWith('workflows/fixtures/') &&
          !file.path.endsWith('-typed.workflow.json'),
      );

      if (added.length === 0) {
        return { passed: false, detail: 'added nothing' };
      }

      const absolute = join(sandbox, added[0].path);
      const validated = runOracle('validate-workflows.cjs', [absolute]);

      if (!validated.ok) {
        return {
          passed: false,
          detail: `workflow:validate refused it: ${firstLine(validated.stdout, validated.stderr)}`,
        };
      }

      const compiled = runOracle('compile-workflow.cjs', [absolute, '--report']);

      if (!compiled.ok) {
        return {
          passed: false,
          detail: `workflow:compile refused it: ${firstLine(compiled.stdout, compiled.stderr)}`,
        };
      }

      const unwired = findUnwiredPorts(compiled.stdout);

      return {
        passed: unwired.length === 0,
        detail:
          unwired.length === 0
            ? `${added[0].path} compiles with every port wired`
            : `unwired: ${unwired.join(', ')}`,
      };
    },
  },
];

// ---------------------------------------------------------------------------------------------

function readJson(sandbox, relativePath) {
  try {
    return JSON.parse(readFileSync(join(sandbox, relativePath), 'utf8'));
  } catch {
    return undefined;
  }
}

function firstLine(...candidates) {
  for (const candidate of candidates) {
    const line = (candidate ?? '').trim().split('\n')[0];

    if (line.length > 0) {
      return line;
    }
  }

  return 'no output';
}

/**
 * Ports the compile report lists with no arms.
 *
 * `--report` prints an unwired *optional* port as `"arms": []` rather than omitting it, so an empty
 * arms list is only a defect on a required one. There is no flag in the report saying which is
 * which, so the optional ports are named here — `manual-review`'s `invalid`, and the `default` that
 * `decision` and `risk-score` only grow with `fallback: true`.
 *
 * The report's shape is `[{ name, type, ports: [{ name, arms }] }]` — `ports` is an array, not an
 * object keyed by port name. Reading it as an object yields array indices for names, which silently
 * defeats the exemption above and reports every unwired optional port as a defect called `step.1`.
 */
function findUnwiredPorts(reportJson) {
  const OPTIONAL_PORTS = new Set(['invalid', 'default']);

  let steps;

  try {
    steps = JSON.parse(reportJson);
  } catch {
    return ['report was not JSON'];
  }

  if (!Array.isArray(steps)) {
    return ['report was not a list of steps'];
  }

  const unwired = [];

  for (const step of steps) {
    if (!Array.isArray(step?.ports)) {
      continue;
    }

    for (const port of step.ports) {
      if (Array.isArray(port?.arms) && port.arms.length === 0 && !OPTIONAL_PORTS.has(port.name)) {
        unwired.push(`${step.name ?? '?'}.${port.name ?? '?'}`);
      }
    }
  }

  return unwired;
}

/**
 * One arm of one case. The sandbox is a full clone-on-write copy, so the agent has a working
 * repository — it can run `pnpm workflow:compile` exactly as the skill tells it to, which is part of
 * what is being measured. The `without` arm differs by one deleted directory and nothing else.
 */
async function runArm({ testCase, arm, model, runIndex }) {
  const label = `${testCase.name}-${arm}-${runIndex}`;
  const sandbox = await createSandbox(label);

  try {
    if (arm === 'without') {
      rmSync(join(sandbox, '.claude/skills', testCase.skill), { force: true, recursive: true });
    }

    const run = await runClaude({
      cwd: sandbox,
      prompt: testCase.prompt,
      model,
      permissionMode: 'bypassPermissions',
      maxBudgetUsd: MAX_BUDGET_USD,
      timeoutMs: TIMEOUT_MS,
    });

    const usedSkill = run.skillsUsed.includes(testCase.skill);
    const failure = describeRunFailure(run);

    // A run that timed out, blew its budget or died in transport never answered. Grading its
    // sandbox would score "the harness broke" as "the model got it wrong", which moves the delta
    // this whole script exists to measure. It is counted as neither a pass nor a failure.
    if (failure !== undefined) {
      return {
        arm,
        costUsd: run.costUsd,
        detail: failure,
        errored: true,
        passed: false,
        usedSkill,
      };
    }

    const graded = testCase.grade({ changedFiles: collectChangedFiles(sandbox), sandbox });

    return {
      arm,
      costUsd: run.costUsd,
      detail: graded.detail,
      errored: false,
      passed: graded.passed,
      usedSkill,
    };
  } finally {
    removeSandbox(sandbox);
  }
}

function parseArgs(argv) {
  const options = {
    dryRun: argv.includes('--dry-run'),
    filter: undefined,
    model: MODEL,
    runs: RUNS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--runs') {
      options.runs = Number.parseInt(argv[index + 1], 10);
    }

    if (argv[index] === '--case') {
      options.filter = argv[index + 1];
    }

    if (argv[index] === '--model') {
      options.model = argv[index + 1];
    }
  }

  if (!Number.isInteger(options.runs) || options.runs < 1) {
    throw new Error('--runs takes a positive integer');
  }

  return options;
}

/**
 * Pass rate over the runs that produced an answer. Errored runs are excluded from `total` rather
 * than counted as failures, and reported separately, so a case whose arms ran a different number of
 * times cannot be read as a delta.
 */
function summarise(outcomes) {
  const graded = outcomes.filter((outcome) => !outcome.errored);

  return {
    passed: graded.filter((outcome) => outcome.passed).length,
    total: graded.length,
    errored: outcomes.length - graded.length,
  };
}

/**
 * Prints the sweep. It is written to stdout rather than to a file because nothing reads a stored
 * sweep — comparing one against the last would need a reader that does not exist, and a report
 * committed without one is an artifact nobody opens. Redirect this if a run is worth keeping.
 */
function printReport(report) {
  const lines = [
    '# Skill ablation',
    '',
    `Model \`${report.model}\`, ${report.runs} runs per arm. Spent ${formatUsd(report.spent)}${
      report.estimated ? ' (at least; partly estimated)' : ''
    }.`,
    '',
    ...(report.errored > 0
      ? [
          `${report.errored} run(s) did not finish and are excluded from the counts below, so an ` +
            `arm may have fewer runs than the other. They are listed as \`error\` under Runs.`,
          '',
        ]
      : []),
    '| Case | Rule | With | Without | Delta |',
    '| --- | --- | --- | --- | --- |',
    ...report.cases.map(
      (entry) =>
        `| ${entry.name} | ${entry.rule} | ${formatArm(entry.with)} | ${formatArm(entry.without)} | ${formatDelta(entry)} |`,
    ),
    '',
    '## Runs',
    '',
    ...report.cases.flatMap((entry) => [
      `### ${entry.name}`,
      '',
      ...entry.outcomes.map(
        (outcome) =>
          `- \`${outcome.arm}\` ${describeOutcome(outcome)}${outcome.arm === 'with' && !outcome.errored ? ` (skill fired: ${outcome.usedSkill})` : ''} — ${outcome.detail}`,
      ),
      '',
    ]),
  ];

  console.log(lines.join('\n'));
}

function describeOutcome(outcome) {
  if (outcome.errored) {
    return 'error';
  }

  return outcome.passed ? 'pass' : 'fail';
}

function formatArm(arm) {
  return `${arm.passed}/${arm.total}${arm.errored > 0 ? ` (+${arm.errored} errored)` : ''}`;
}

/**
 * The gap between the arms, as a rate rather than a count — the arms no longer necessarily ran the
 * same number of times once errored runs are dropped, and subtracting raw counts across unequal
 * denominators reports a delta that was never measured. An arm with nothing left to count has no
 * delta to state.
 */
function formatDelta(entry) {
  if (entry.with.total === 0 || entry.without.total === 0) {
    return 'not measured — an arm produced no gradeable run';
  }

  const delta = entry.with.passed / entry.with.total - entry.without.passed / entry.without.total;
  const points = Math.round(delta * 100);

  if (points === 0) {
    return '0 — the skill changed nothing here';
  }

  return `${points > 0 ? '+' : ''}${points} points`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cases = CASES.filter(
    (testCase) => options.filter === undefined || testCase.name.includes(options.filter),
  );

  if (cases.length === 0) {
    console.error(`No case matches "${options.filter}".`);
    return 1;
  }

  const totalRuns = cases.length * options.runs * 2;

  console.log(
    `${cases.length} cases x ${options.runs} runs x 2 arms = ${totalRuns} agent runs on ${options.model}, via ${describeEnvironment()}.\n`,
  );

  if (options.dryRun) {
    for (const testCase of cases) {
      console.log(
        `${testCase.name}  [${testCase.skill}]\n  rule: ${testCase.rule}\n  ${testCase.prompt}\n`,
      );
    }

    console.log('Dry run: nothing was spent.');
    return 0;
  }

  // The workflow oracles import a build artifact that running them directly does not produce. Doing
  // it once, up front, keeps a stale `dist` from failing every case for a reason no case is about.
  ensureOracleBuild();

  const report = {
    cases: [],
    errored: 0,
    estimated: false,
    model: options.model,
    runs: options.runs,
    spent: 0,
  };

  for (const testCase of cases) {
    const outcomes = [];

    for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
      for (const arm of ['with', 'without']) {
        const outcome = await runArm({ testCase, arm, model: options.model, runIndex });

        report.spent += outcome.costUsd;
        report.errored += outcome.errored ? 1 : 0;
        report.estimated ||= outcome.errored;
        outcomes.push(outcome);

        console.log(
          `  ${testCase.name} ${arm.padEnd(7)} run ${runIndex + 1}  ${describeOutcome(outcome).padEnd(5)} ${outcome.detail}`,
        );
      }
    }

    const entry = {
      name: testCase.name,
      outcomes,
      rule: testCase.rule,
      skill: testCase.skill,
      with: summarise(outcomes.filter((outcome) => outcome.arm === 'with')),
      without: summarise(outcomes.filter((outcome) => outcome.arm === 'without')),
    };

    report.cases.push(entry);

    console.log(
      `${entry.name}: with ${formatArm(entry.with)}, without ${formatArm(entry.without)}\n`,
    );
  }

  printReport(report);

  // Always zero. This measures rather than gates: a case both arms fail is information about the
  // case, and a non-zero exit would invite someone to wire it into a pipeline where it does not
  // belong.
  return 0;
}

module.exports = { CASES, findUnwiredPorts, formatDelta, parseArgs, summarise };

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
