#!/usr/bin/env node

/**
 * Fails unless `CHANGELOG.md` changed since the branch left `base`. Every pull request adds its line
 * to the changelog's `## Unreleased` section; CI runs this on each one.
 *
 * Compares the merge base with the working tree, so an uncommitted edit counts locally. In CI the
 * pull request's merge commit is checked out, and `HEAD^1` is the base branch's tip.
 *
 * Usage:
 *   pnpm changelog:check              # against origin/main
 *   pnpm changelog:check HEAD^1       # what CI runs
 */

const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');
const CHANGELOG = 'CHANGELOG.md';

function git(...args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function changelogChanged(changedFiles) {
  return changedFiles.includes(CHANGELOG);
}

function main() {
  const base = process.argv[2] ?? 'origin/main';
  const mergeBase = git('merge-base', base, 'HEAD');
  const changed = git('diff', '--name-only', mergeBase).split('\n');
  if (changelogChanged(changed)) {
    console.log(`${CHANGELOG} is updated.`);
    return;
  }
  console.error(
    `${CHANGELOG} is unchanged since ${base}. Add a line for this change under "## Unreleased" ` +
      '(see CONTRIBUTING.md#changelog).',
  );
  process.exit(1);
}

if (require.main === module) main();

module.exports = { changelogChanged };
