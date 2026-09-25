#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

const { ensureEncryptionCleared } = require('./e2e-encryption-preflight.cjs');

const composeScript = resolve(__dirname, 'compose.cjs');

function runStep(command, args, description) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    const error = new Error(`${description} failed with exit code ${result.status ?? 1}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

async function main() {
  let failure;

  try {
    runStep('node', [composeScript, 'up', '-d', '--build', '--wait', 'engine'], 'Start test stack');
    // The suites set their own deterministic key-encryption key, so a key left behind by local use
    // of the panel cannot be unwrapped and takes every suite down at `app.init()` — with an error
    // about unwrapping that points nowhere near the cause. Clear it, decrypting every row first.
    await ensureEncryptionCleared();
    // The worker drains the same outbox the engine's e2e suites assert on, so a developer whose
    // full stack is already up sees a dozen outbox, audit and webhook assertions fail on rows
    // already sent and attempts already made. Stopping it makes a run mean the same thing whether
    // or not the stack was up beforehand, the way `stack:integration:up` already does; the teardown
    // below removes the container either way. `stop` is a no-op when the container does not exist.
    // It runs after the preflight, which needs the worker: only it sweeps (`MODE=worker-only`).
    runStep('node', [composeScript, 'stop', 'engine-worker'], 'Stop the worker container');
    runStep('pnpm', ['-r', '--if-present', 'run', 'test:e2e'], 'Run e2e suites');
  } catch (error) {
    failure = error;
  } finally {
    try {
      // `--profile '*'` so teardown covers profiled services too: a container from a disabled
      // profile is neither in scope nor an orphan, so a plain `down --remove-orphans` walks past
      // an `engine-mailhog-test` left behind by an interrupted run.
      runStep(
        'node',
        [composeScript, '--profile', '*', 'down', '--remove-orphans'],
        'Stop test stack',
      );
    } catch (error) {
      if (!failure) {
        failure = error;
      }
    }
  }

  if (failure) {
    throw failure;
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(error.exitCode ?? 1);
});
