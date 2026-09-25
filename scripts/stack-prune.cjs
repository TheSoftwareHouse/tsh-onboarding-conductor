#!/usr/bin/env node

// Frees what a `--build` of the engine image leaves behind. Each build that changes the image
// re-tags `tsh-onboarding-conductor-engine:local` and leaves the previous image dangling, and the
// build cache keeps every superseded layer. On a Docker VM (Rancher Desktop, Docker Desktop) the
// `node_modules` trees inside those layers exhaust the filesystem's inodes long before its bytes —
// `df` still shows free space while the next build fails with `ENOSPC: no space left on device`.
//
//   node scripts/stack-prune.cjs          this project's dangling images only
//   node scripts/stack-prune.cjs --all    also every unused build-cache record, of every project on
//                                         this Docker host, so the next build starts cold

const { spawnSync } = require('node:child_process');

const projectName = process.env.COMPOSE_PROJECT_NAME ?? 'tsh-onboarding-conductor';
const all = process.argv.includes('--all');

function runDocker(args) {
  const result = spawnSync('docker', args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

// Without `--all`, `image prune` removes dangling images only; the label narrows that to the ones
// Compose built for this project, so another project's leftovers are never touched from here.
runDocker([
  'image',
  'prune',
  '--force',
  '--filter',
  `label=com.docker.compose.project=${projectName}`,
]);

if (all) {
  runDocker(['builder', 'prune', '--all', '--force']);
}
