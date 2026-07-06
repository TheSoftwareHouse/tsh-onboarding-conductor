#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

function commandAvailable(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });

  return (result.status ?? 1) === 0;
}

function resolveComposeCommand() {
  if (commandAvailable('docker', ['compose', 'version'])) {
    return ['docker', 'compose'];
  }

  if (commandAvailable('docker-compose', ['version'])) {
    return ['docker-compose'];
  }

  throw new Error("Neither 'docker compose' nor 'docker-compose' is available");
}

const args = process.argv.slice(2);
const [command, ...commandArgs] = resolveComposeCommand();
const result = spawnSync(command, [...commandArgs, ...args], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  throw result.error;
}

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}
