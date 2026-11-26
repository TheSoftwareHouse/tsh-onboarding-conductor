#!/usr/bin/env node

/**
 * Prints one version's `CHANGELOG.md` section, for the GitHub Release's notes. Fails when the
 * section is missing or empty.
 *
 * Usage:
 *   pnpm release:notes 0.1.2
 */

const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { releaseNotes } = require('./release-lib.cjs');
const { SEMVER } = require('./version-bump-lib.cjs');

const REPO_ROOT = resolve(__dirname, '..');

function main() {
  const version = process.argv[2];
  if (!version || !SEMVER.test(version)) {
    throw new Error('Usage: pnpm release:notes X.Y.Z');
  }
  console.log(releaseNotes(readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8'), version));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
