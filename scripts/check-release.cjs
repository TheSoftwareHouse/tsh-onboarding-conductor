#!/usr/bin/env node

/**
 * Fails a pull request that changes the product version unless it is a proper release pull request
 * (ADR 0054): branch `release/<new version>`, only the files `version:bump` writes, up to date with
 * `base`. A pull request that leaves every `package.json` version alone passes untouched.
 *
 * Compares `head` with its merge base against `base`. In CI the pull request's merge commit is
 * checked out, so `HEAD^1` is main's tip and `HEAD^2` the pull request's head. The branch comes from
 * `GITHUB_HEAD_REF`, else the current branch. `HEAD_REPO` and `BASE_REPO`, when both are set, must
 * match: a release branch cannot come from a fork.
 *
 * Usage:
 *   pnpm release:check                       # origin/main against HEAD
 *   pnpm release:check HEAD^1 HEAD^2         # what CI runs
 */

const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');
const { releasePullRequestProblems } = require('./release-lib.cjs');
const { packageFiles, releaseFiles } = require('./version-bump.cjs');

const REPO_ROOT = resolve(__dirname, '..');
const ROOT_PACKAGE = 'package.json';

function git(...args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

/** A file's text at a revision, or undefined when it does not exist there (a new workspace). */
function show(rev, path) {
  try {
    return execFileSync('git', ['show', `${rev}:${path}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
}

function versionOf(packageJsonText) {
  return JSON.parse(packageJsonText).version;
}

/** A path missing at the base has no old version, so it counts as unchanged. */
function versionChanged(oldText, newText) {
  return oldText !== undefined && versionOf(oldText) !== versionOf(newText);
}

function main() {
  const base = process.argv[2] ?? 'origin/main';
  const head = process.argv[3] ?? 'HEAD';
  const mergeBase = git('merge-base', base, head);
  const files = packageFiles();

  const changed = files.some((file) => versionChanged(show(mergeBase, file), show(head, file)));
  if (!changed) {
    console.log(`No package.json version changes since ${base}; not a release pull request.`);
    return;
  }

  const oldVersion = versionOf(show(mergeBase, ROOT_PACKAGE));
  const newVersion = versionOf(show(head, ROOT_PACKAGE));
  const { HEAD_REPO: headRepo, BASE_REPO: baseRepo } = process.env;
  const problems = releasePullRequestProblems({
    branch: process.env.GITHUB_HEAD_REF || git('rev-parse', '--abbrev-ref', 'HEAD'),
    oldVersion,
    newVersion,
    changedFiles: git('diff', '--name-only', mergeBase, head).split('\n').filter(Boolean),
    releaseFiles: releaseFiles(),
    upToDate: mergeBase === git('rev-parse', base),
    sameRepository: !headRepo || !baseRepo || headRepo === baseRepo,
    changelog: show(head, 'CHANGELOG.md'),
  });
  if (problems.length === 0) {
    console.log(`Release pull request for ${newVersion} is valid.`);
    return;
  }
  console.error(`Not a valid release pull request (${oldVersion} -> ${newVersion}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { versionOf, versionChanged };
