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

const { execFileSync, spawn } = require('node:child_process');
const { mkdirSync, readdirSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const REPO_ROOT = resolve(__dirname, '..');

/**
 * Entries never copied into a sandbox. `.git` is deliberately *not* among them: the agent's output
 * is graded by asking git what changed, which is both exact and free, and a clone-on-write copy
 * makes carrying the history cost nothing.
 */
const UNCOPIED_ENTRIES = new Set(['.DS_Store']);

/**
 * Makes a throwaway copy of the repository for one agent run.
 *
 * `cp -Rc` asks APFS for a clone: the copy shares blocks with the original until something writes
 * to it, so a 600 MB working tree with `node_modules` intact costs seconds and almost no disk. That
 * matters because the sandbox has to be a *working* repository — the skills under test tell an
 * agent to run `pnpm workflow:compile`, and a sandbox where that command cannot run would measure
 * something other than what the skill does. On a filesystem without clone support the flag is
 * dropped and the copy is real, which is slower but correct.
 *
 * The copy is then committed, because the parent repository is almost never clean — a branch in
 * progress, an untracked script — and `collectChangedFiles` reads `git status`. Without that the
 * grader attributes whatever the author happened to have uncommitted to the agent. Committing
 * rather than subtracting a baseline is what makes it airtight: a file the author had modified and
 * the agent then modified further is indistinguishable by status alone, but is an ordinary
 * modification against a clean tree.
 */
function createSandbox(label) {
  const root = join(tmpdir(), 'tsh-skill-eval', label);

  rmSync(root, { force: true, recursive: true });
  mkdirSync(root, { recursive: true });

  const entries = readdirSync(REPO_ROOT).filter((entry) => !UNCOPIED_ENTRIES.has(entry));

  for (const flags of [['-Rc'], ['-R']]) {
    try {
      execFileSync('cp', [...flags, ...entries.map((entry) => join(REPO_ROOT, entry)), root], {
        stdio: 'pipe',
      });

      commitSandboxBaseline(root);

      return root;
    } catch (error) {
      if (flags.includes('-c')) {
        continue;
      }

      throw new Error(`Could not create a sandbox at ${root}: ${error.message}`);
    }
  }

  throw new Error(`Could not create a sandbox at ${root}`);
}

/**
 * Commits the copied tree so the agent starts from a clean `git status`. Identity is passed per
 * command rather than written into the config, and hooks are skipped: this repository's pre-commit
 * hook runs ESLint and Prettier, which have nothing to say about a snapshot and would only make
 * sandbox creation fail whenever the working tree was mid-edit.
 */
function commitSandboxBaseline(root) {
  const git = (...args) =>
    execFileSync(
      'git',
      ['-c', 'user.name=skill-eval', '-c', 'user.email=skill-eval@invalid', ...args],
      { cwd: root, stdio: 'pipe' },
    );

  try {
    git('add', '-A');
    git('commit', '--no-verify', '--allow-empty', '-q', '-m', 'skill-eval sandbox baseline');
  } catch (error) {
    throw new Error(
      `Could not commit the sandbox baseline at ${root}, so agent changes could not have been ` +
        `told apart from the working tree they were copied from: ${error.message}`,
    );
  }

  const dirty = execFileSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' });

  if (dirty.trim().length > 0) {
    throw new Error(
      `The sandbox at ${root} is still dirty after its baseline commit, so grading would have ` +
        `attributed these to the agent:\n${dirty}`,
    );
  }
}

function removeSandbox(root) {
  rmSync(root, { force: true, recursive: true });
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

  return new Promise((resolveRun, rejectRun) => {
    const child = spawn('claude', args, {
      cwd,
      // The child inherits this process's authentication. Nothing is written to the parent
      // repository: every tool the agent has is pointed at `cwd`, which is a sandbox.
      env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const toolUses = [];
    const skillsUsed = [];
    const usage = { byModel: {}, seen: new Set() };
    let pending = '';
    let stderr = '';
    let result;
    let stoppedEarly = false;

    const timer = setTimeout(() => {
      stoppedEarly = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const handleMessage = (message) => {
      if (message.type === 'result') {
        result = message;
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
      rejectRun(new Error(`Could not run claude: ${error.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const estimate = estimateCostUsd(usage.byModel);
      const reported = result?.total_cost_usd;

      resolveRun({
        code,
        costEstimated: typeof reported !== 'number',
        costUnpriced: estimate.unpriced,
        costUsd: typeof reported === 'number' ? reported : estimate.usd,
        result,
        skillsUsed,
        stderr,
        stoppedEarly,
        toolUses,
        tokens: sumTokens(usage.byModel),
        usageByModel: usage.byModel,
      });
    });
  });
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

/** Files the agent added, changed or deleted, straight from the sandbox's own git. */
function collectChangedFiles(sandbox) {
  const output = execFileSync('git', ['status', '--porcelain=v1', '-z'], {
    cwd: sandbox,
    encoding: 'utf8',
  });

  return output
    .split('\0')
    .filter((entry) => entry.length > 3)
    .map((entry) => ({ status: entry.slice(0, 2).trim(), path: entry.slice(3) }));
}

function formatUsd(amount) {
  return `$${amount.toFixed(2)}`;
}

/**
 * Why a run cannot be graded, or `undefined` if it can.
 *
 * A run that timed out, blew its budget cap or died in transport produced no answer, and grading
 * its empty sandbox as "the model did the wrong thing" is the way an ablation reports a delta it
 * did not measure. Callers that stop a run deliberately pass `expectEarlyStop`.
 */
function describeRunFailure(run, { expectEarlyStop = false } = {}) {
  if (run.stoppedEarly && !expectEarlyStop) {
    return 'the run was stopped before it finished (timeout or budget cap)';
  }

  const subtype = run.result?.subtype;

  if (subtype !== undefined && subtype !== 'success') {
    return `the harness ended the run as "${subtype}"`;
  }

  if (run.result === undefined && !expectEarlyStop) {
    return `the harness produced no result message (exit ${run.code})${
      run.stderr.trim().length > 0 ? `: ${run.stderr.trim().split('\n')[0]}` : ''
    }`;
  }

  return undefined;
}

/**
 * Names the credential a sweep will bill against, for the caller to print before it spends
 * anything. Both callers spend real money, and the failure mode worth surfacing is a suite that
 * quietly runs on the wrong account. This only reports; neither caller is interactive, so there is
 * nobody to confirm with and nothing here refuses.
 */
function describeEnvironment() {
  const viaApiKey = typeof process.env.ANTHROPIC_API_KEY === 'string';

  return viaApiKey ? 'ANTHROPIC_API_KEY' : 'the logged-in Claude Code account';
}

module.exports = {
  MODEL_PRICES_PER_MTOK,
  REPO_ROOT,
  collectChangedFiles,
  createSandbox,
  describeEnvironment,
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
