#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

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

let failure;

try {
  runStep('node', [composeScript, 'up', '-d', '--wait', 'mailhog'], 'Start MailHog test stack');
  // `engine-mailhog-test` sits in the `mailhog-test` profile so no unscoped `up` — `pnpm
  // stack:up` — starts a jest run against the dev database. `--profile` goes before the
  // subcommand, and is passed explicitly rather than relying on `run` enabling the target
  // service's own profiles, so this keeps working whatever Compose does with that shorthand.
  runStep(
    'node',
    [composeScript, '--profile', 'mailhog-test', 'run', '--rm', '--build', 'engine-mailhog-test'],
    'Run MailHog integration test',
  );
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
      'Stop MailHog test stack',
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
