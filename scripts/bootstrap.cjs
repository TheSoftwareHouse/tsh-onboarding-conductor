#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

console.log('Bootstrapping workspace (this will implicitly run Husky prepare scripts)...');

const result = spawnSync('pnpm', ['install'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
