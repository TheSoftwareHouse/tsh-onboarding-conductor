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
  runStep(
    'node',
    [composeScript, 'run', '--rm', '--build', 'engine-mailhog-test'],
    'Run MailHog integration test',
  );
} catch (error) {
  failure = error;
} finally {
  try {
    runStep('node', [composeScript, 'down', '--remove-orphans'], 'Stop MailHog test stack');
  } catch (error) {
    if (!failure) {
      failure = error;
    }
  }
}

if (failure) {
  throw failure;
}
