#!/usr/bin/env node

/**
 * Releases the monorepo's single product version: works out the next version from the squash-merge
 * commits since the last `v*` tag, writes it into every version file, prepends a CHANGELOG entry,
 * commits and tags. It never pushes — `.github/workflows/release.yml` does.
 *
 * The root `package.json` version is the current version V:
 *   - V has no tag yet -> release V as it is (the first run, or a version a maintainer set by hand
 *     in a PR), without bumping; the entry is generated only if the PR did not write one.
 *   - V is tagged and nothing but release commits follows -> nothing to do.
 *   - V is tagged and other commits follow -> bump (see `nextVersion` in `release-lib.cjs`).
 *
 * Subjects and bodies are untrusted text (PR titles): git is called with argument arrays through
 * `execFileSync`, never a shell string.
 *
 * Usage:
 *   node scripts/release.cjs              # release, committing and tagging locally
 *   node scripts/release.cjs --dry-run    # print what would happen, touch nothing
 */

const { execFileSync } = require('node:child_process');
const { existsSync, readdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { join, relative, resolve } = require('node:path');
const {
  parseCommit,
  isReleaseCommit,
  nextVersion,
  renderEntry,
  prependEntry,
  hasEntry,
} = require('./release-lib.cjs');

const REPO_ROOT = resolve(__dirname, '..');
const ROOT_PACKAGE = 'package.json';
const CHANGELOG = 'CHANGELOG.md';
const OPENAPI_DOCUMENT = 'packages/shared/openapi/engine.openapi.json';
const WORKSPACE_FILE = 'pnpm-workspace.yaml';
const SEMVER = /^\d+\.\d+\.\d+$/;
const CHANGELOG_INTRO = `# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

One product version covers the whole monorepo. Every pull request merged into \`main\` bumps it and
adds an entry here, generated from the squash-merge commit subject (the PR title). See
[CONTRIBUTING.md](CONTRIBUTING.md#versioning).
`;

function git(...args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

function gitSucceeds(...args) {
  try {
    execFileSync('git', args, { cwd: REPO_ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

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

/** Every file that carries the product version, relative to the repository root. */
function versionFiles() {
  return [ROOT_PACKAGE, ...workspaceGlobs().flatMap(expandGlob), OPENAPI_DOCUMENT];
}

/**
 * Replaces one version value in place, textually, so no other byte of the file changes — neither
 * `package.json`'s layout nor the generated OpenAPI document's. `anchor` locates the object whose
 * first following `"version"` key at `indent` is the one to rewrite.
 */
function replaceVersion(text, next, { anchor, indent }) {
  const from = anchor ? text.indexOf(anchor) : 0;
  if (from === -1) throw new Error(`Could not find ${anchor} to rewrite its version`);
  const pattern = new RegExp(`(\\n${indent}"version": ")[^"]*(")`, 'g');
  pattern.lastIndex = from;
  const match = pattern.exec(text);
  if (!match) throw new Error('Could not find a version value to rewrite');
  return text.slice(0, match.index) + match[1] + next + match[2] + text.slice(pattern.lastIndex);
}

/** The file's text with the product version set to `next`; nothing is written. */
function rewriteVersion(path, next) {
  const text = readText(path);
  const rewritten =
    path === OPENAPI_DOCUMENT
      ? replaceVersion(text, next, { anchor: '\n  "info": {', indent: '    ' })
      : replaceVersion(text, next, { anchor: null, indent: '  ' });
  const written = JSON.parse(rewritten);
  const actual = path === OPENAPI_DOCUMENT ? written.info.version : written.version;
  if (actual !== next) throw new Error(`${path}: expected version ${next}, found ${actual}`);
  return rewritten;
}

function newestTag() {
  try {
    return execFileSync('git', ['describe', '--tags', '--match', 'v*', '--abbrev=0', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** Parses `git log -z --format=%s%x1f%b` output, dropping the release bot's own commits. */
function parseGitLog(log) {
  return log
    .split('\0')
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [subject, body = ''] = record.split('\x1f');
      return { subject: subject.trim(), body };
    })
    .filter(({ subject }) => !isReleaseCommit(subject))
    .map(({ subject, body }) => parseCommit(subject, body));
}

/** Parsed commits since `tag`, oldest first. */
function commitsSince(tag) {
  if (!tag) return [];
  return parseGitLog(git('log', '--reverse', '-z', '--format=%s%x1f%b', `${tag}..HEAD`));
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const current = JSON.parse(readText(ROOT_PACKAGE)).version;
  if (!SEMVER.test(current)) {
    throw new Error(`${ROOT_PACKAGE} version "${current}" is not X.Y.Z; fix it and rerun`);
  }
  const tag = newestTag();
  const commits = commitsSince(tag);
  const currentTagged = gitSucceeds('rev-parse', '-q', '--verify', `refs/tags/v${current}`);

  if (currentTagged && commits.length === 0) {
    console.log(`Nothing to release: v${current} is current.`);
    return;
  }

  const next = currentTagged ? nextVersion(current, commits) : current;
  if (next !== current && gitSucceeds('rev-parse', '-q', '--verify', `refs/tags/v${next}`)) {
    throw new Error(`Tag v${next} already exists; refusing to release over it`);
  }

  // Every new file text is computed before the first write, so a failure leaves the tree untouched.
  const writes = new Map();
  if (next !== current) {
    for (const file of versionFiles()) writes.set(file, rewriteVersion(file, next));
  }

  const changelog = existsSync(join(REPO_ROOT, CHANGELOG)) ? readText(CHANGELOG) : CHANGELOG_INTRO;
  if (commits.length > 0 && !hasEntry(changelog, next)) {
    const isoDate = new Date().toISOString().slice(0, 10);
    const entry = renderEntry(next, isoDate, commits);
    writes.set(CHANGELOG, prependEntry(changelog, entry));
  }

  const files = [...writes.keys()];
  const subject = `chore(release): v${next} [skip ci]`;
  const plan = files.length === 0 ? `baseline: tag v${next}, no file changes` : `release v${next}`;
  console.log(`${dryRun ? '[dry-run] ' : ''}${plan}`);
  for (const file of files) console.log(`  write   ${relative('.', file)}`);
  if (files.length > 0) console.log(`  commit  ${subject}`);
  console.log(`  tag     v${next}`);
  if (dryRun) return;

  for (const [file, text] of writes) writeFileSync(join(REPO_ROOT, file), text);
  if (files.length > 0) {
    git('add', '--', ...files);
    git('commit', '-m', subject);
  }
  git('tag', `v${next}`);
}

if (require.main === module) main();

module.exports = {
  replaceVersion,
  parseGitLog,
  workspaceGlobs,
  expandGlob,
  versionFiles,
  SEMVER,
  CHANGELOG_INTRO,
};
