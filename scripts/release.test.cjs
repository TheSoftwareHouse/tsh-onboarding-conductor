const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const {
  replaceVersion,
  parseGitLog,
  expandGlob,
  versionFiles,
  SEMVER,
  CHANGELOG_INTRO,
} = require('./release.cjs');
const { prependEntry, hasEntry } = require('./release-lib.cjs');

const REPO_ROOT = resolve(__dirname, '..');
const OPENAPI = 'packages/shared/openapi/engine.openapi.json';

function differingLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  assert.equal(a.length, b.length);
  return a.flatMap((line, i) => (line === b[i] ? [] : [[line, b[i]]]));
}

describe('replaceVersion', () => {
  it('changes only the version line of the real OpenAPI document', () => {
    const text = readFileSync(join(REPO_ROOT, OPENAPI), 'utf8');
    const out = replaceVersion(text, '9.8.7', { anchor: '\n  "info": {', indent: '    ' });
    const diff = differingLines(text, out);
    assert.equal(diff.length, 1);
    assert.equal(diff[0][1], diff[0][0].replace(/"version": "[^"]*"/, '"version": "9.8.7"'));
    assert.equal(JSON.parse(out).info.version, '9.8.7');
  });

  it('changes only the version line of a package.json', () => {
    const text = readFileSync(join(REPO_ROOT, 'package.json'), 'utf8');
    const out = replaceVersion(text, '9.8.7', { anchor: null, indent: '  ' });
    const diff = differingLines(text, out);
    assert.equal(diff.length, 1);
    assert.equal(diff[0][1], diff[0][0].replace(/"version": "[^"]*"/, '"version": "9.8.7"'));
    assert.equal(JSON.parse(out).version, '9.8.7');
  });
});

describe('parseGitLog', () => {
  it('parses NUL-separated records, keeps multi-line bodies and drops only the bot commits', () => {
    const log = [
      'feat(api): add x (#1)\x1fBody line one\n\nBREAKING CHANGE: gone\n',
      'chore(release): v0.0.2 [skip ci]\x1f',
      'chore(release): 1.0.0 (#130)\x1f',
      'fix: tidy (#2)\x1f',
      '',
    ].join('\0');
    assert.deepEqual(
      parseGitLog(log).map((c) => [c.type, c.description, c.breaking, c.pr]),
      [
        ['feat', 'add x', true, 1],
        ['chore', '1.0.0', false, 130],
        ['fix', 'tidy', false, 2],
      ],
    );
  });
});

describe('workspace discovery', () => {
  it('finds the ten package.json files (root and nine workspaces) and the OpenAPI document', () => {
    const files = versionFiles();
    assert.equal(files[0], 'package.json');
    assert.equal(files.at(-1), OPENAPI);
    assert.equal(files.filter((file) => file.endsWith('package.json')).length, 10);
    assert.ok(files.includes('packages/engine/package.json'));
    assert.ok(files.includes('packages/shared/ddl-schema/package.json'));
  });

  it('rejects a glob it does not understand', () => {
    assert.throws(() => expandGlob('packages/**'), /Unsupported workspace glob/);
  });
});

describe('release preconditions', () => {
  it('accepts only X.Y.Z versions', () => {
    for (const ok of ['0.0.1', '1.20.3']) assert.ok(SEMVER.test(ok), ok);
    for (const bad of ['1.0', '1.0.0-rc.1', 'v1.0.0', '1.0.0 ', '', '1.x.0']) {
      assert.ok(!SEMVER.test(bad), bad);
    }
  });

  it('treats a missing CHANGELOG.md as the intro-only file', () => {
    const out = prependEntry(CHANGELOG_INTRO, '## 0.0.2 — 2026-10-13\n');
    assert.ok(out.startsWith('# Changelog\n'));
    assert.ok(hasEntry(out, '0.0.2'));
  });
});
