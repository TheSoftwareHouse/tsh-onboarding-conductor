#!/usr/bin/env node

/**
 * Shared machinery for the two model-driven skill checks — `test-skill-routing.cjs`, which measures
 * whether a skill is reached for, and `test-skill-ablation.cjs`, which measures whether having it
 * changes what comes out. Neither runs in CI: both spend money and neither is deterministic, so
 * they are commands a person runs when a decision is pending. `validate-skills.cjs` is the layer
 * that runs on every commit.
 *
 * This module owns three things those two must agree on: how a headless `claude` is invoked, how
 * its stream is read, and how a disposable copy of the repository is made for it to work in.
 *
 * Requiring it is side-effect-free; it is not a command.
 */

const { execFile, execFileSync, spawn } = require('node:child_process');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const REPO_ROOT = resolve(__dirname, '..');

/**
 * The environment variables that would bill a run to something other than the machine's signed-in
 * Claude Code account — an API key, a gateway token, Bedrock or Vertex. Every child `claude` starts
 * without them, so a developer who keeps a key exported for other work still runs these checks on
 * their own account, and no check here can be run against the API at all. That is the whole
 * arrangement: these are subscription-billed local commands, and there is no CI job or secret that
 * could make them anything else.
 */
const CREDENTIAL_ENVIRONMENT_VARIABLES = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'AWS_BEARER_TOKEN_BEDROCK',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
];

/**
 * Entries never copied into a sandbox. `.git` is deliberately *not* among them: the agent's output
 * is graded by asking git what changed, which is both exact and free, and a clone-on-write copy
 * makes carrying the history cost nothing.
 */
const UNCOPIED_ENTRIES = new Set(['.DS_Store']);

/**
 * What this process still holds: the sandboxes it created and has not removed, and the children
 * it spawned that have not exited — `claude`, and the `cp` and `git` that make a sandbox.
 * `abortActiveRuns` reads both from a signal handler.
 */
const activeSandboxes = new Set();

/**
 * One sandbox tree per invocation of this process. A label is deterministic —
 * `<skill>-<case>-<run>` for the golden sets, `<case>-<arm>-<run>` for the ablation — so two
 * commands running at once (two `skills:evals`, or an `skills:ablation` beside one) would resolve
 * the same case to the same directory, and `createSandbox` opens by deleting whatever is there.
 * The second invocation then wipes the first's baseline commit out from under it and the first
 * fails its `git diff` with `fatal: bad object`, which reads as an errored run and fails the case
 * for a reason that has nothing to do with the skill. Scoping by pid and start time keeps the
 * label readable in the report while making concurrent invocations independent of each other.
 */
const SANDBOX_ROOT = join(
  tmpdir(),
  'tsh-skill-eval',
  `run-${process.pid}-${Date.now().toString(36)}`,
);
const activeChildren = new Set();

/**
 * Runs a command to completion without blocking the event loop, so a stop signal is handled while
 * the command runs rather than once it is over; the child is registered like an agent run, so
 * `abortActiveRuns` ends it too. Rejects with the harness's error, whose `signal` names what
 * ended the child when a signal did.
 */
function runCommand(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = execFile(command, args, { ...options, encoding: 'utf8' }, (error, stdout) => {
      activeChildren.delete(child);

      if (error) {
        rejectRun(error);
        return;
      }

      resolveRun(stdout);
    });

    activeChildren.add(child);
  });
}

/**
 * Makes a throwaway copy of the repository for one agent run.
 *
 * `cp -Rc` asks APFS for a clone: the copy shares blocks with the original until something writes
 * to it, so a 600 MB working tree with `node_modules` intact costs seconds and almost no disk. That
 * matters because the sandbox has to be a *working* repository — the skills under test tell an
 * agent to run `pnpm workflow:compile`, and a sandbox where that command cannot run would measure
 * something other than what the skill does. On a filesystem without clone support (Linux CI, an
 * external disk) everything but `node_modules` is copied for real and `node_modules` becomes a
 * symlink to the repository's own: pnpm's per-package `node_modules` are relative symlinks into
 * the root one, so they resolve through it unchanged, and the copy stays seconds rather than
 * minutes.
 *
 * The copy is then committed, because the parent repository is almost never clean — a branch in
 * progress, an untracked script — and `collectChangedFiles` asks git what changed. Without that the
 * grader attributes whatever the author happened to have uncommitted to the agent. Committing
 * rather than subtracting a status baseline is what makes it airtight: a file the author had
 * modified and the agent then modified further is indistinguishable by status alone, but is an
 * ordinary modification against a clean tree — and a commit is also something a later diff can be
 * taken against, whatever the agent then does with git.
 */
async function createSandbox(label) {
  const root = join(SANDBOX_ROOT, label);

  rmSync(root, { force: true, recursive: true });
  mkdirSync(root, { recursive: true });
  // Registered before the copy, so a stop signal during it removes the half-made sandbox too.
  activeSandboxes.add(root);

  const entries = readdirSync(REPO_ROOT).filter((entry) => !UNCOPIED_ENTRIES.has(entry));

  try {
    await runCommand('cp', ['-Rc', ...entries.map((entry) => join(REPO_ROOT, entry)), root]);
  } catch (error) {
    if (error.signal) {
      // Ended by a signal — a stop request — not a filesystem that cannot clone.
      removeSandbox(root);
      throw new Error(`The copy for the sandbox at ${root} was stopped by ${error.signal}`);
    }

    // GNU cp has no `-c`, and a BSD cp on a filesystem that cannot clone fails too. Start over
    // rather than continue from whatever a failed clone left behind.
    rmSync(root, { force: true, recursive: true });
    mkdirSync(root, { recursive: true });

    const copied = entries.filter((entry) => entry !== 'node_modules');

    try {
      await runCommand('cp', ['-R', ...copied.map((entry) => join(REPO_ROOT, entry)), root]);
    } catch (fallbackError) {
      removeSandbox(root);
      throw new Error(`Could not create a sandbox at ${root}: ${fallbackError.message}`);
    }

    if (entries.includes('node_modules')) {
      symlinkSync(join(REPO_ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');
    }
  }

  disableSandboxHooks(root);

  try {
    await commitSandboxBaseline(root);
  } catch (error) {
    removeSandbox(root);
    throw error;
  }

  return root;
}

/**
 * Removes this repository's own hooks from the copied settings. `.claude/settings.json` wires
 * `skill-evals-reminder.cjs` to every edit and every stop, which is a message for a person working
 * on a skill — and inside a sandbox it would reach the agent being measured instead: the reminder
 * as context it never asked for, and a `Stop` hook that keeps it from ever finishing its run.
 * `SKILL_EVALS_SANDBOX` in the child's environment tells the script the same thing; this is the
 * half that holds even if a future hook is not this script.
 */
function disableSandboxHooks(root) {
  for (const name of ['settings.json', 'settings.local.json']) {
    const file = join(root, '.claude', name);

    if (!existsSync(file)) {
      continue;
    }

    try {
      const settings = JSON.parse(readFileSync(file, 'utf8'));

      if (settings.hooks === undefined) {
        continue;
      }

      delete settings.hooks;
      writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
    } catch {
      // A settings file that does not parse has no hooks Claude Code will run either; the
      // environment guard covers the rest.
    }
  }
}

/**
 * Commits the copied tree so the agent starts from a clean `git status`. Identity is passed per
 * command rather than written into the config, and hooks are skipped: this repository's pre-commit
 * hook runs ESLint and Prettier, which have nothing to say about a snapshot and would only make
 * sandbox creation fail whenever the working tree was mid-edit.
 */
async function commitSandboxBaseline(root) {
  const git = (...args) =>
    runCommand(
      'git',
      ['-c', 'user.name=skill-eval', '-c', 'user.email=skill-eval@invalid', ...args],
      { cwd: root },
    );

  try {
    await git('add', '-A');
    await git('commit', '--no-verify', '--allow-empty', '-q', '-m', 'skill-eval sandbox baseline');
  } catch (error) {
    throw new Error(
      `Could not commit the sandbox baseline at ${root}, so agent changes could not have been ` +
        `told apart from the working tree they were copied from: ${error.message}`,
    );
  }

  const dirty = await runCommand('git', ['status', '--porcelain=v1'], { cwd: root });

  if (dirty.trim().length > 0) {
    throw new Error(
      `The sandbox at ${root} is still dirty after its baseline commit, so grading would have ` +
        `attributed these to the agent:\n${dirty}`,
    );
  }
}

function removeSandbox(root) {
  activeSandboxes.delete(root);
  // Retries absorb a child that was told to stop and is still writing into the tree.
  rmSync(root, { force: true, maxRetries: 3, recursive: true });
}

/**
 * Per-million-token list prices, longest matching model-id prefix wins. Recorded 2026-09-15 from
 * the `claude-api` skill's model table; Sonnet 5's introductory rate expired 2026-08-31 and the
 * standard rate is used.
 *
 * A table like this goes stale, which is why nothing gates on it: the figure it produces is a
 * printed estimate, always shown next to the exact token counts it was derived from, and a model
 * missing from the table costs the estimate rather than the run. The alternative — reading
 * `total_cost_usd` off the harness's own `result` message — is exact but unavailable precisely
 * when it matters, because a routing run is killed the moment it has answered and never emits one.
 */
const MODEL_PRICES_PER_MTOK = {
  'claude-fable-5': { input: 10, output: 50 },
  'claude-mythos-5': { input: 10, output: 50 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/** Cache tokens are billed as multiples of the model's input rate. */
const CACHE_MULTIPLIERS = { read: 0.1, write5m: 1.25, write1h: 2 };

function priceFor(modelId) {
  const prefixes = Object.keys(MODEL_PRICES_PER_MTOK)
    .filter((prefix) => modelId.startsWith(prefix))
    .sort((a, b) => b.length - a.length);

  return prefixes.length === 0 ? undefined : MODEL_PRICES_PER_MTOK[prefixes[0]];
}

/**
 * Accumulates one assistant message's usage.
 *
 * The harness emits one message per content block and repeats the same `usage` on each, so a naive
 * sum double-counts every turn that thought before it spoke. Keyed on `message.id`, which is the
 * API's own turn identity, the repeats collapse.
 */
function recordUsage(accumulator, message) {
  const id = message?.message?.id;
  const usage = message?.message?.usage;
  const model = message?.message?.model;

  if (typeof id !== 'string' || usage === undefined || typeof model !== 'string') {
    return;
  }

  if (accumulator.seen.has(id)) {
    return;
  }

  accumulator.seen.add(id);

  const totals = (accumulator.byModel[model] ??= {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
  });
  const created = usage.cache_creation ?? {};

  totals.input += usage.input_tokens ?? 0;
  totals.output += usage.output_tokens ?? 0;
  totals.cacheRead += usage.cache_read_input_tokens ?? 0;
  totals.cacheWrite1h += created.ephemeral_1h_input_tokens ?? 0;
  // Anything the harness reports only as an undifferentiated cache write is priced at the 5-minute
  // rate, which is the cheaper of the two — an estimate that errs low is easier to reason about
  // than one that errs high for a reason the reader cannot see.
  totals.cacheWrite5m +=
    created.ephemeral_5m_input_tokens ??
    Math.max(
      0,
      (usage.cache_creation_input_tokens ?? 0) - (created.ephemeral_1h_input_tokens ?? 0),
    );
}

/**
 * Prices an accumulator. `unpriced` names every model the table did not cover.
 *
 * The result is a floor, not a figure to reconcile against a bill. Assistant messages report
 * `output_tokens` excluding thinking tokens — only the `result` message breaks those out — so a run
 * that thought before it answered is undercounted. Measured against a `result` message on one haiku
 * run, the estimate came in at 87% of the harness's own number. Anything that needs to be exact
 * must read `total_cost_usd`, which is why `runClaude` prefers it whenever the run lived long
 * enough to emit one.
 */
function estimateCostUsd(byModel) {
  let usd = 0;
  const unpriced = [];

  for (const [model, totals] of Object.entries(byModel)) {
    const price = priceFor(model);

    if (price === undefined) {
      unpriced.push(model);
      continue;
    }

    usd +=
      (totals.input * price.input +
        totals.cacheRead * price.input * CACHE_MULTIPLIERS.read +
        totals.cacheWrite5m * price.input * CACHE_MULTIPLIERS.write5m +
        totals.cacheWrite1h * price.input * CACHE_MULTIPLIERS.write1h +
        totals.output * price.output) /
      1_000_000;
  }

  return { usd, unpriced };
}

function sumTokens(byModel) {
  return Object.values(byModel).reduce(
    (total, entry) => total + Object.values(entry).reduce((sum, count) => sum + count, 0),
    0,
  );
}

/** Every `tool_use` block in one stream-json message, whatever depth the message nests them at. */
function collectToolUses(message) {
  const content = message?.message?.content;

  if (!Array.isArray(content)) {
    return [];
  }

  return content.filter((block) => block?.type === 'tool_use');
}

/**
 * Runs one headless `claude` and returns what it did.
 *
 * The stream is read rather than the final text because what is being measured is behaviour — which
 * skill fired, which files were touched — and the final text is a summary the model wrote about
 * itself. `onToolUse` may return `'stop'` to end the run as soon as the answer is known, which is
 * the whole cost control for routing: the verdict lands on the first tool call and paying for the
 * work that would follow buys nothing.
 *
 * Cost is reported two ways because the accurate one is not always there. `total_cost_usd` on the
 * harness's `result` message is authoritative, but a run `onToolUse` stopped never produces one, so
 * usage is also accumulated off the assistant messages and priced locally. `costEstimated` says
 * which number this is.
 *
 * The same command doubles as a plain model call. `systemPrompt` replaces the harness's own system
 * prompt, `jsonSchema` makes the harness validate the answer and return it parsed as
 * `structuredOutput`, `strictMcpConfig` drops every MCP server the machine has configured — the
 * connectors a developer has attached cost tens of thousands of tokens per call and are never what
 * a skill is about — and `disableSkills` keeps the run from loading skill descriptions. Together
 * with `tools: []` that is a judge call: one turn, a few thousand tokens, no tools.
 */
function runClaude({
  cwd,
  prompt,
  model,
  tools,
  permissionMode = 'bypassPermissions',
  maxBudgetUsd,
  timeoutMs = 15 * 60 * 1000,
  onToolUse,
  systemPrompt,
  jsonSchema,
  strictMcpConfig = false,
  disableSkills = false,
}) {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--permission-mode',
    permissionMode,
  ];

  if (model !== undefined) {
    args.push('--model', model);
  }

  if (tools !== undefined) {
    args.push('--tools', tools.join(','));
  }

  if (maxBudgetUsd !== undefined) {
    args.push('--max-budget-usd', String(maxBudgetUsd));
  }

  if (systemPrompt !== undefined) {
    args.push('--system-prompt', systemPrompt);
  }

  if (jsonSchema !== undefined) {
    args.push('--json-schema', JSON.stringify(jsonSchema));
  }

  if (strictMcpConfig) {
    args.push('--strict-mcp-config');
  }

  if (disableSkills) {
    args.push('--disable-slash-commands');
  }

  return new Promise((resolveRun, rejectRun) => {
    const child = spawn('claude', args, {
      cwd,
      // The child authenticates as the signed-in Claude Code account and nothing else: every
      // credential variable that would route it elsewhere is dropped (`localAccountEnv`). Nothing
      // is written to the parent repository either — every tool the agent has is pointed at `cwd`,
      // which is a sandbox, and `SKILL_EVALS_SANDBOX` keeps this repository's own hooks quiet
      // inside it.
      env: localAccountEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeChildren.add(child);

    const toolUses = [];
    const skillsUsed = [];
    // The skills the harness discovered for this run, off its first message. A prompt that invokes
    // one as `/name …` is only an invocation if the name is in here; otherwise it is plain text.
    let availableSkills = [];
    const usage = { byModel: {}, seen: new Set() };
    let pending = '';
    let stderr = '';
    let result;
    let stoppedEarly = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      stoppedEarly = true;
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const handleMessage = (message) => {
      if (message.type === 'result') {
        result = message;
        return;
      }

      if (message.type === 'system' && message.subtype === 'init') {
        availableSkills = Array.isArray(message.slash_commands)
          ? message.slash_commands.filter((name) => typeof name === 'string')
          : [];
        return;
      }

      recordUsage(usage, message);

      for (const toolUse of collectToolUses(message)) {
        toolUses.push(toolUse);

        if (toolUse.name === 'Skill' && typeof toolUse.input?.skill === 'string') {
          skillsUsed.push(toolUse.input.skill);
        }

        if (onToolUse?.(toolUse) === 'stop') {
          stoppedEarly = true;
          child.kill('SIGTERM');
          return;
        }
      }
    };

    child.stdout.on('data', (chunk) => {
      pending += chunk;

      const lines = pending.split('\n');

      pending = lines.pop() ?? '';

      for (const line of lines) {
        if (line.trim().length === 0) {
          continue;
        }

        try {
          handleMessage(JSON.parse(line));
        } catch {
          // A line the harness emitted that is not a message — a warning on stdout, a partial
          // flush. Dropping it is right: the run is judged on the messages that did parse.
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      rejectRun(new Error(`Could not run claude: ${error.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      const estimate = estimateCostUsd(usage.byModel);
      const reported = result?.total_cost_usd;

      resolveRun({
        availableSkills,
        code,
        costEstimated: typeof reported !== 'number',
        costUnpriced: estimate.unpriced,
        costUsd: typeof reported === 'number' ? reported : estimate.usd,
        result,
        // The final answer as text, and — when `jsonSchema` was given — the same answer parsed and
        // validated by the harness. Neither exists on a run that was stopped or that errored.
        resultText: typeof result?.result === 'string' ? result.result : undefined,
        structuredOutput: result?.structured_output,
        skillsUsed,
        stderr,
        stoppedEarly,
        timedOut,
        timeoutMs,
        toolUses,
        tokens: sumTokens(usage.byModel),
        usageByModel: usage.byModel,
      });
    });
  });
}

/**
 * Stops every child this process still has running and removes the sandboxes it still holds,
 * unless asked to keep them; returns what is left on disk. Meant for a signal handler: synchronous,
 * and it does not wait for the children to exit — a `SIGTERM` lets the harness shut its own
 * subprocesses down on its way out.
 */
function abortActiveRuns({ keepSandboxes = false } = {}) {
  const stoppedRuns = activeChildren.size;

  for (const child of activeChildren) {
    child.kill('SIGTERM');
  }

  activeChildren.clear();

  const sandboxesLeft = [];

  for (const root of activeSandboxes) {
    if (keepSandboxes) {
      sandboxesLeft.push(root);
      continue;
    }

    try {
      removeSandbox(root);
    } catch {
      sandboxesLeft.push(root);
    }
  }

  return { stoppedRuns, sandboxesLeft };
}

/**
 * Builds what the oracles import, once per process.
 *
 * `compile-workflow.cjs` requires `packages/shared/ddl-schema/dist`, which is a build artifact and
 * is gitignored; the `pnpm workflow:compile` script builds it first and running the file directly
 * does not. A stale or absent `dist` makes the oracle reject valid workflows with
 * `WORKFLOW_INVALID`, which grades every case a failure for a reason that has nothing to do with
 * the skill under test. Failing loudly here beats a sweep of zeroes.
 */
let oracleBuildDone = false;

function ensureOracleBuild() {
  if (oracleBuildDone) {
    return;
  }

  try {
    execFileSync('pnpm', ['--filter', '@tsh/ddl-schema', 'build'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
  } catch (error) {
    throw new Error(
      `Could not build @tsh/ddl-schema, which the workflow oracles import, so every case would ` +
        `have been graded against a stale compiler: ${error.message}`,
    );
  }

  oracleBuildDone = true;
}

/**
 * Runs one of the repository's own scripts against a path, as an oracle over an agent's output.
 * Call `ensureOracleBuild()` once before the first workflow oracle of a sweep.
 */
function runOracle(scriptName, args) {
  try {
    const stdout = execFileSync('node', [join(REPO_ROOT, 'scripts', scriptName), ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, stdout: error.stdout ?? '', stderr: error.stderr ?? error.message };
  }
}

/**
 * Files the agent added, changed or deleted, straight from the sandbox's own git.
 *
 * Given the `baseline` commit the sandbox started from, the working tree is compared with that
 * commit — `A`, `M` or `D` per path — and the untracked files are added as `??`. That view survives
 * whatever the agent did with git along the way: a file it wrote and then committed is still an
 * added file, where `git status` alone would report a clean tree and grade the work as never done.
 * Without a baseline the status is read as it stands, which is what the ablation wants — its agent
 * is never asked to publish anything.
 */
function collectChangedFiles(sandbox, baseline) {
  const git = (args) => execFileSync('git', args, { cwd: sandbox, encoding: 'utf8' });
  const entries = (output) => output.split('\0').filter((entry) => entry.length > 0);

  if (baseline === undefined) {
    return entries(git(['status', '--porcelain=v1', '-z']))
      .filter((entry) => entry.length > 3)
      .map((entry) => ({ status: entry.slice(0, 2).trim(), path: entry.slice(3) }));
  }

  // `--name-status -z` emits the status and the path as separate NUL-terminated fields;
  // `--no-renames` keeps a rename as a deletion and an addition, so every entry is one path.
  const diffed = entries(git(['diff', '--name-status', '--no-renames', '-z', baseline]));
  const changed = [];

  for (let index = 0; index + 1 < diffed.length; index += 2) {
    changed.push({ status: diffed[index].trim(), path: diffed[index + 1] });
  }

  for (const path of entries(git(['ls-files', '--others', '--exclude-standard', '-z']))) {
    changed.push({ status: '??', path });
  }

  return changed;
}

function formatUsd(amount) {
  return `$${amount.toFixed(2)}`;
}

/** How many trailing stderr lines a failure description quotes; the report carries the tail. */
const STDERR_LINES_IN_FAILURE = 3;
const RESULT_ERROR_LIMIT_CHARS = 300;
const MILLISECONDS_PER_MINUTE = 60_000;

/**
 * Why a run cannot be graded, or `undefined` if it can.
 *
 * A run that timed out, blew its budget cap or died in transport produced no answer, and grading
 * its empty sandbox as "the model did the wrong thing" is the way an ablation reports a delta it
 * did not measure. Callers that stop a run deliberately pass `expectEarlyStop`. The harness's own
 * error text travels with the reason when it gave one, so "ended as error_during_execution" says
 * what the error was.
 */
function describeRunFailure(run, { expectEarlyStop = false } = {}) {
  if (run.timedOut) {
    return `the run was killed at its time cap of ${Math.round(run.timeoutMs / MILLISECONDS_PER_MINUTE)} min`;
  }

  if (run.stoppedEarly && !expectEarlyStop) {
    return 'the run was stopped before it finished';
  }

  const subtype = run.result?.subtype;

  if (subtype !== undefined && subtype !== 'success') {
    const detail = describeResultError(run.result);

    return `the harness ended the run as "${subtype}"${detail === undefined ? '' : `: ${detail}`}`;
  }

  if (run.result === undefined && !expectEarlyStop) {
    const lastLines = run.stderr
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(-STDERR_LINES_IN_FAILURE);

    return `the harness produced no result message (exit ${run.code})${
      lastLines.length > 0 ? `: ${lastLines.join(' | ')}` : ''
    }`;
  }

  return undefined;
}

/**
 * The harness's own account of why it ended a run, when it gave one. An errored `result` message
 * carries the error as its `result` text or, on some versions, as an `errors` list.
 */
function describeResultError(result) {
  if (result?.is_error !== true) {
    return undefined;
  }

  const texts = [];

  if (typeof result.result === 'string' && result.result.trim().length > 0) {
    texts.push(result.result.trim());
  }

  if (Array.isArray(result.errors)) {
    texts.push(...result.errors.filter((entry) => typeof entry === 'string'));
  }

  if (texts.length === 0) {
    return undefined;
  }

  const joined = texts.join(' | ').replace(/\s+/g, ' ');

  return joined.length > RESULT_ERROR_LIMIT_CHARS
    ? `${joined.slice(0, RESULT_ERROR_LIMIT_CHARS)}…`
    : joined;
}

/**
 * Names what a sweep bills against, for the caller to print before it spends anything. There is one
 * answer: these checks run on the machine's signed-in Claude Code account, because that is the only
 * credential the child is given.
 */
function describeEnvironment() {
  return 'the signed-in Claude Code account';
}

/**
 * The credential variables that are set here and will not reach the child, for the caller to say so
 * once rather than leave a developer wondering which account paid.
 */
function ignoredCredentialVariables() {
  return CREDENTIAL_ENVIRONMENT_VARIABLES.filter((name) => {
    const value = process.env[name];

    return typeof value === 'string' && value !== '';
  });
}

/** This process's environment minus every credential variable, for a child `claude`. */
function localAccountEnv() {
  const env = {
    ...process.env,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    SKILL_EVALS_SANDBOX: '1',
  };

  for (const name of CREDENTIAL_ENVIRONMENT_VARIABLES) {
    delete env[name];
  }

  return env;
}

module.exports = {
  CREDENTIAL_ENVIRONMENT_VARIABLES,
  MODEL_PRICES_PER_MTOK,
  REPO_ROOT,
  abortActiveRuns,
  collectChangedFiles,
  createSandbox,
  describeEnvironment,
  ignoredCredentialVariables,
  localAccountEnv,
  describeRunFailure,
  ensureOracleBuild,
  estimateCostUsd,
  formatUsd,
  recordUsage,
  removeSandbox,
  runClaude,
  runOracle,
};

if (require.main === module) {
  console.error(
    'This module is shared machinery. Run pnpm skills:routing or pnpm skills:ablation.',
  );
  process.exit(2);
}
