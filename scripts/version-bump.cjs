#!/usr/bin/env node

/**
 * Bumps the monorepo's single product version, on the `release/X.Y.Z` branch for that version, in a
 * pull request of its own (ADR 0050); on any other branch it refuses before writing anything:
 *   1. turns `CHANGELOG.md`'s `## Unreleased` section into the `## X.Y.Z — <date>` entry;
 *   2. writes X.Y.Z into the root `package.json` and every workspace's;
 *   3. regenerates the OpenAPI document (`info.version` is the engine's version) and the
 *      documentation site's API pages built from it.
 * It never commits, tags or pushes: review the diff and open the pull request.
 *
 * Usage:
 *   pnpm version:bump patch|minor|major
 *   pnpm version:bump 1.0.0
 */

const { execFileSync } = require('node:child_process');
const { existsSync, readdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { nextVersion, replaceVersion, releaseUnreleased } = require('./version-bump-lib.cjs');
const { releaseBranch, OPENAPI_DOCUMENT, OPENAPI_ARCHIVE } = require('./release-lib.cjs');

const REPO_ROOT = resolve(__dirname, '..');
const ROOT_PACKAGE = 'package.json';
const CHANGELOG = 'CHANGELOG.md';
const WORKSPACE_FILE = 'pnpm-workspace.yaml';

function readText(path) {
  return readFileSync(join(REPO_ROOT, path), 'utf8');
}

/**
 * The `packages:` globs of `pnpm-workspace.yaml`. Every glob in this repository is `dir/*`, which is
 * all this reads; a richer pattern fails loudly rather than being skipped.
 */
function workspaceGlobs() {
  const lines = readText(WORKSPACE_FILE).split('\n');
  const start = lines.findIndex((line) => line.trim() === 'packages:');
  const globs = [];
  for (const line of lines.slice(start + 1)) {
    const item = /^\s+-\s+['"]?([^'"]+?)['"]?\s*$/.exec(line);
    if (!item) break;
    globs.push(item[1]);
  }
  return globs;
}

function expandGlob(glob) {
  if (!glob.endsWith('/*') || glob.slice(0, -2).includes('*')) {
    throw new Error(`Unsupported workspace glob "${glob}": only "dir/*" is understood`);
  }
  const base = glob.slice(0, -2);
  return readdirSync(join(REPO_ROOT, base))
    .map((name) => join(base, name, 'package.json'))
    .filter(
      (path) => existsSync(join(REPO_ROOT, path)) && statSync(join(REPO_ROOT, path)).isFile(),
    );
}

/** Every `package.json` that carries the product version, relative to the repository root. */
function packageFiles() {
  return [ROOT_PACKAGE, ...workspaceGlobs().flatMap(expandGlob)];
}

/** What a bump commits: the exact files, and directories of which any file counts (the OpenAPI archive). */
function releaseFiles() {
  return {
    files: [CHANGELOG, ...packageFiles(), OPENAPI_DOCUMENT],
    directories: [OPENAPI_ARCHIVE],
  };
}

function pnpm(...args) {
  console.log(`\n$ pnpm ${args.join(' ')}`);
  execFileSync('pnpm', args, { cwd: REPO_ROOT, stdio: 'inherit' });
}

function main() {
  const target = process.argv[2];
  if (!target) {
    throw new Error('Usage: pnpm version:bump patch|minor|major|X.Y.Z');
  }
  const current = JSON.parse(readText(ROOT_PACKAGE)).version;
  const next = nextVersion(current, target);

  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
  if (branch !== releaseBranch(next)) {
    throw new Error(
      `Version ${next} is cut on the branch "${releaseBranch(next)}", not "${branch}": ` +
        `create it from an up-to-date main, then run this again.`,
    );
  }

  // Every new file text is computed before the first write, so a refusal leaves the tree untouched.
  const isoDate = new Date().toISOString().slice(0, 10);
  const writes = new Map([[CHANGELOG, releaseUnreleased(readText(CHANGELOG), next, isoDate)]]);
  for (const file of packageFiles()) writes.set(file, replaceVersion(readText(file), next));

  console.log(`Bumping ${current} -> ${next}`);
  for (const [file, text] of writes) {
    writeFileSync(join(REPO_ROOT, file), text);
    console.log(`  wrote ${file}`);
  }

  pnpm('openapi:generate');
  pnpm('--filter', '@tsh/docs', 'run', 'api:generate');

  console.log(`\nVersion ${next} is ready: review the diff, then open a pull request with it.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { workspaceGlobs, expandGlob, packageFiles, releaseFiles };
