#!/usr/bin/env node

/**
 * Measures whether a skill is reached for at all.
 *
 * A skill's `description` and `when_to_use` are the only part of it a model sees before deciding
 * whether to open it, and they are the part nothing else checks. A skill can be perfectly written
 * and never fire; it can also fire on work it does not cover, which costs a session its context
 * budget and points the model at rules that do not apply. Both failures are invisible from reading
 * the file, and both are cheap to measure: the verdict lands on the first tool call, so each case
 * is a few seconds on a small model.
 *
 * This does not measure whether the skill helps — `test-skill-ablation.cjs` measures that, and it
 * is the question to answer first. Tuning trigger phrases on a skill that turns out not to change
 * the output is optimising the wrong thing.
 *
 * What is scored is this repository's own skills, the ones under `.claude/skills/`. A session here
 * also has whatever plugins `.claude/settings.json` enables, and one of those firing is neither a
 * pass nor a failure of a skill written here — it is a fact about the machine the sweep ran on.
 * Those are reported separately and named in the summary, so a result is readable by someone with a
 * different plugin set. A run only ends early on a skill from this repository; a plugin skill is
 * recorded and the run continues, because the question is whether the local skill is reached at
 * all, not whether something else got there first.
 *
 * Costs money and is not deterministic, so it does not run in CI. Run it when a description or a
 * `when_to_use` changes.
 *
 * Usage:
 *   pnpm skills:routing                  # every case below
 *   pnpm skills:routing --runs 5         # more runs per case
 *   pnpm skills:routing --case workflow  # only cases whose name contains "workflow"
 *   pnpm skills:routing --model sonnet   # confirm a haiku failure on a session-grade model
 *   pnpm skills:routing --dry-run        # print the plan and spend nothing
 */

const { existsSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const { describeEnvironment, formatUsd, REPO_ROOT, runClaude } = require('./skill-eval-runner.cjs');

// ---------------------------------------------------------------------------------------------
// Defaults. Edit these rather than prefixing the command with environment variables.
// ---------------------------------------------------------------------------------------------

/**
 * The model that makes the routing decision.
 *
 * This is the setting that most changes what the numbers mean, so treat a result as being about one
 * model rather than about the skill. A weaker model reaches for the wrong skill more often, and a
 * sweep on `haiku` reports failures a session on `opus` would not have. `haiku` is the default
 * because it is roughly ten times cheaper and catches the descriptions that are ambiguous to
 * anything; confirm anything it fails against the model your sessions actually run on, with
 * `--model sonnet` or `--model opus`, before rewriting a `when_to_use` on its say-so.
 */
const MODEL = 'haiku';

/** Per case. Routing is nearly deterministic, so three runs is enough to expose a coin flip. */
const RUNS = 3;

/** Per run. Roughly $0.20 is normal; anything near this cap means a run went exploring. */
const MAX_BUDGET_USD = 0.5;

/**
 * What the model may do: invoke a skill, and read.
 *
 * Restricting this to `Skill` alone makes a run fifty times cheaper and was the first version, but
 * it decides the negative cases for you — a model with no other tool available has no way to act
 * except by reaching for a skill, so "no skill should fire" becomes unmeasurable. Reading costs
 * about $0.20 a run and buys back the only cases that catch over-triggering. Nothing here can
 * write, so this runs in the repository itself rather than in a sandbox.
 *
 * A negative case therefore runs to completion — there is no way to know a skill will *not* fire
 * except by letting the model finish. Only a positive verdict can end a run early. `MAX_BUDGET_USD`
 * is what bounds the rest.
 */
const TOOLS = ['Skill', 'Read', 'Grep', 'Glob'];

/**
 * The cases.
 *
 * `expect: null` means no skill should fire — those matter more than the positive cases, because
 * over-triggering is the failure that a skill's author never sees. Keep the prompts in the words a
 * person would actually use, and never quote the skill's own trigger phrases back at it: a case
 * written from `when_to_use` tests nothing but the author's memory.
 */
const CASES = [
  {
    name: 'workflow-add-flow',
    prompt:
      'Add a new onboarding flow for UK sole traders that collects contact details and runs KYC.',
    expect: 'creating-workflows',
  },
  {
    name: 'workflow-add-step',
    prompt:
      'The EEA individual flow needs to ask for proof of address before the selfie step. Add it.',
    expect: 'creating-workflows',
  },
  {
    name: 'workflow-startup-failure',
    prompt: 'The engine container exits on boot with WorkflowInvalidError. What is wrong?',
    expect: 'creating-workflows',
  },
  {
    name: 'bff-build',
    prompt: 'I need a backend service that sits between our React app and the onboarding engine.',
    expect: 'creating-engine-bffs',
  },
  {
    name: 'bff-error-mapping',
    prompt:
      'Our web client gets a 409 from the engine when it uploads a document twice. How should the BFF handle that?',
    expect: 'creating-engine-bffs',
  },
  {
    name: 'negative-new-step-type',
    prompt: 'Add a new step type to the DDL that captures a bank account number.',
    expect: null,
    note: 'A step type is engine code with its own section in docs/EXTENDING.md, not a workflow document.',
  },
  {
    name: 'negative-admin-panel',
    prompt: 'The Connectors tab in the admin panel should show which workflows use each connector.',
    expect: null,
    note: 'React work in @tsh/admin-panel; neither skill covers it.',
  },
  {
    name: 'negative-unrelated',
    prompt: 'Why does pnpm test:e2e leave containers running when it fails?',
    expect: null,
  },
];

// ---------------------------------------------------------------------------------------------

/** The skills this repository ships, which are the only ones a case can expect. */
function collectLocalSkillNames() {
  const directory = join(REPO_ROOT, '.claude/skills');

  if (!existsSync(directory)) {
    return new Set();
  }

  return new Set(
    readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
}

/**
 * One run. It ends the moment a skill from this repository is invoked — by then the routing
 * decision is made and everything after it is paid-for noise. A plugin skill is recorded and the
 * run carries on, so that a plugin reaching for the work first cannot be mistaken for the local
 * skill failing to fire.
 */
async function routeOnce(testCase, model, localSkills) {
  let routedTo = null;
  const plugins = [];

  const run = await runClaude({
    cwd: REPO_ROOT,
    prompt: testCase.prompt,
    model,
    tools: TOOLS,
    permissionMode: 'bypassPermissions',
    maxBudgetUsd: MAX_BUDGET_USD,
    timeoutMs: 3 * 60 * 1000,
    onToolUse: (toolUse) => {
      if (toolUse.name !== 'Skill') {
        return undefined;
      }

      const skill = toolUse.input?.skill;

      if (typeof skill !== 'string') {
        return undefined;
      }

      if (!localSkills.has(skill)) {
        plugins.push(skill);
        return undefined;
      }

      routedTo = skill;

      return 'stop';
    },
  });

  if (routedTo !== null) {
    return { routedTo, plugins, costUsd: run.costUsd, costEstimated: run.costEstimated };
  }

  // No local skill fired. That is a real verdict only if the run finished on its own — a run the
  // harness aborted (the budget cap, a transport failure) decided nothing, and scoring it as "no
  // skill" would report a passing negative case that never ran.
  const completed = run.result?.subtype === 'success' || run.code === 0;

  return {
    routedTo: completed ? null : 'ERROR',
    plugins,
    costUsd: run.costUsd,
    costEstimated: run.costEstimated,
  };
}

function parseArgs(argv) {
  const options = {
    runs: RUNS,
    filter: undefined,
    model: MODEL,
    dryRun: argv.includes('--dry-run'),
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

function describeExpectation(testCase) {
  return testCase.expect === null ? 'no skill' : testCase.expect;
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

  const localSkills = collectLocalSkillNames();

  console.log(
    `${cases.length} cases x ${options.runs} runs on ${options.model}, via ${describeEnvironment()}.`,
  );
  console.log(`Scoring the skills in .claude/skills: ${[...localSkills].sort().join(', ')}.\n`);

  const unknownExpectations = cases
    .filter((testCase) => testCase.expect !== null && !localSkills.has(testCase.expect))
    .map((testCase) => `${testCase.name} expects "${testCase.expect}"`);

  // A case naming a skill that no longer exists can never pass, and a rename is exactly when
  // someone would run this. Saying so beats a column of failures with no cause attached.
  if (unknownExpectations.length > 0) {
    console.error(`No such skill in .claude/skills: ${unknownExpectations.join('; ')}.`);
    return 1;
  }

  if (options.dryRun) {
    for (const testCase of cases) {
      console.log(
        `${testCase.name}\n  expect: ${describeExpectation(testCase)}\n  ${testCase.prompt}\n`,
      );
    }

    console.log('Dry run: nothing was spent.');
    return 0;
  }

  let spent = 0;
  let anyEstimated = false;
  let failedCases = 0;
  const pluginsSeen = new Set();

  for (const testCase of cases) {
    const routes = [];
    const plugins = [];

    for (let run = 0; run < options.runs; run += 1) {
      const outcome = await routeOnce(testCase, options.model, localSkills);

      spent += outcome.costUsd;
      anyEstimated ||= outcome.costEstimated;
      routes.push(outcome.routedTo);
      plugins.push(...outcome.plugins);
      outcome.plugins.forEach((plugin) => pluginsSeen.add(plugin));
    }

    const hits = routes.filter((route) => route === testCase.expect).length;
    const passed = hits === options.runs;
    const tally = [...new Set(routes)]
      .map((route) => `${route ?? 'no skill'} x${routes.filter((other) => other === route).length}`)
      .join(', ');

    failedCases += passed ? 0 : 1;

    // A case that routes correctly on some runs and not others is the interesting result and must
    // not be flattened into a pass, which is why the tally is printed even when everything passed.
    console.log(
      `${passed ? 'ok  ' : 'FAIL'}  ${testCase.name.padEnd(28)} ${hits}/${options.runs} -> ${describeExpectation(testCase)}  [${tally}]`,
    );

    // Printed, never scored. A plugin taking the work says nothing about the skills in this
    // repository, but it is the first thing a reader wonders about when a case reads oddly.
    if (plugins.length > 0) {
      console.log(`      also fired (plugin, not scored): ${[...new Set(plugins)].join(', ')}`);
    }

    if (!passed && testCase.note !== undefined) {
      console.log(`      ${testCase.note}`);
    }
  }

  console.log(`\n${cases.length - failedCases}/${cases.length} cases routed as expected.`);

  if (pluginsSeen.size > 0) {
    console.log(
      `Plugin skills fired alongside: ${[...pluginsSeen].sort().join(', ')}. A machine with a ` +
        `different plugin set will not reproduce those lines.`,
    );
  }

  // Marked when any run was stopped before the harness reported its own total, because the
  // locally priced fallback excludes thinking tokens and therefore reads low.
  console.log(`Spent ${formatUsd(spent)}${anyEstimated ? ' (at least; partly estimated)' : ''}.`);

  return failedCases === 0 ? 0 : 1;
}

module.exports = { CASES, MODEL, parseArgs };

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
