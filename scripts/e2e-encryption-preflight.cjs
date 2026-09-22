#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const composeScript = resolve(__dirname, 'compose.cjs');
const envFile = resolve(__dirname, '..', '.env');

/**
 * How long the decrypt sweep gets to move every row back to plain JSON. It moves
 * `ENCRYPTION_SWEEP_BATCH_SIZE` rows per `ENCRYPTION_SWEEP_POLL_INTERVAL_MS` (100 per 5s by
 * default) and waits one key-ring refresh interval before the first batch, so this is generous for
 * a development database and still bounded: past it, something is wrong and deleting keys would be
 * unsafe.
 */
const DRAIN_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 2_000;

function compose(args, { capture = false } = {}) {
  const result = spawnSync('node', [composeScript, ...args], {
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

  if ((result.status ?? 1) !== 0) {
    throw new Error(`docker compose ${args.join(' ')} failed with exit code ${result.status ?? 1}`);
  }

  return capture ? result.stdout : '';
}

/** `ENGINE_PORT` the way Compose resolves it: the shell first, then `.env`, then the default. */
function resolveEnginePort() {
  if (process.env.ENGINE_PORT) {
    return process.env.ENGINE_PORT;
  }

  if (existsSync(envFile)) {
    const match = readFileSync(envFile, 'utf8').match(/^\s*ENGINE_PORT\s*=\s*(\S+)\s*$/m);

    if (match) {
      return match[1];
    }
  }

  return '3000';
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function readState(baseUrl) {
  const response = await fetch(`${baseUrl}/v1/admin/encryption`);

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      'the engine refused an unauthenticated admin read; set ADMIN_AUTH_ENABLED=false in .env to ' +
        'run the e2e suites against this stack',
    );
  }

  if (!response.ok) {
    throw new Error(`GET /v1/admin/encryption answered ${response.status}`);
  }

  return response.json();
}

/** Counts onboarding rows still holding an envelope, straight from Postgres. */
function countEnvelopes() {
  const sql = "select count(*) from onboardings where context ? '__tsh_enc';";
  const out = compose(
    [
      'exec',
      '-T',
      'postgres',
      'sh',
      '-c',
      `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -A -t -c "${sql}"`,
    ],
    { capture: true },
  );

  return Number(out.trim());
}

/**
 * Leaves `encryption_keys` empty and every `onboardings.context` row as plain JSON, so the e2e
 * suites can boot with the deterministic key-encryption key they set for themselves.
 *
 * Without this, a developer who has turned encryption on locally cannot run the suites at all: the
 * key ring refuses to start when it finds an active key its `ENCRYPTION_KEY` cannot unwrap, every
 * suite fails at `app.init()`, and the suite's own `DELETE FROM encryption_keys` teardown never
 * runs because it needs a booted application. The failure names an unwrap, which points nowhere
 * near the cause.
 *
 * The order matters and is the whole safety argument: decrypt every row first, prove it with a
 * direct count, and only then discard the keys. Deleting keys while any row still names one makes
 * that row permanently unreadable — there is no escrow — so the count is a hard gate, not a
 * diagnostic, and anything short of zero aborts the run instead.
 */
async function ensureEncryptionCleared() {
  const baseUrl = `http://localhost:${resolveEnginePort()}`;
  const state = await readState(baseUrl);

  if (state.keys.length === 0) {
    return;
  }

  console.log(
    `[e2e-preflight] ${state.keys.length} encryption key(s) left over from local use; turning ` +
      'encryption off and decrypting every onboarding before the suites run.',
  );

  if (state.enabled) {
    const response = await fetch(`${baseUrl}/v1/admin/encryption`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    if (!response.ok) {
      throw new Error(`PATCH /v1/admin/encryption answered ${response.status}`);
    }
  }

  // Only `engine-worker` runs the sweep — the `engine` container is `MODE=api-only` — so it has to
  // be up for anything to move. `test-e2e.cjs` stops it again before the suites start.
  compose(['up', '-d', '--wait', 'engine-worker']);

  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  let pending = Number.POSITIVE_INFINITY;

  while (Date.now() < deadline) {
    ({
      progress: { pending },
    } = await readState(baseUrl));

    if (pending === 0) {
      break;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  const envelopes = countEnvelopes();

  if (pending !== 0 || envelopes !== 0) {
    throw new Error(
      `the decrypt sweep did not finish (${pending} pending, ${envelopes} row(s) still ` +
        'encrypted). Refusing to delete the keys: every row still naming one would become ' +
        'permanently unreadable. Fix the cause, or clear the database volume, and re-run.',
    );
  }

  compose([
    'exec',
    '-T',
    'postgres',
    'sh',
    '-c',
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DELETE FROM encryption_keys"',
  ]);

  console.log('[e2e-preflight] every onboarding is plain JSON again and the key history is clear.');
}

module.exports = { ensureEncryptionCleared };
