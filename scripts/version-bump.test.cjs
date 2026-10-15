const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { nextVersion, replaceVersion, releaseUnreleased } = require('./version-bump-lib.cjs');
const { expandGlob, packageFiles } = require('./version-bump.cjs');
const { changelogChanged } = require('./check-changelog.cjs');

const REPO_ROOT = resolve(__dirname, '..');

describe('nextVersion', () => {
  it('bumps patch, minor and major, resetting the lower parts', () => {
    assert.equal(nextVersion('0.9.9', 'patch'), '0.9.10');
    assert.equal(nextVersion('0.9.9', 'minor'), '0.10.0');
    assert.equal(nextVersion('0.9.9', 'major'), '1.0.0');
  });

  it('takes an explicit version above the current one', () => {
    assert.equal(nextVersion('0.1.0', '1.0.0'), '1.0.0');
  });

  it('refuses an explicit version that is not above the current one', () => {
    assert.throws(() => nextVersion('0.2.0', '0.2.0'), /not above/);
    // Numeric, not string, comparison: 0.9.0 sorts after 0.10.0 as text.
    assert.throws(() => nextVersion('0.10.0', '0.9.0'), /not above/);
  });

  it('refuses anything that is not a bump keyword or X.Y.Z', () => {
    assert.throws(() => nextVersion('0.1.0', '1.0.0-rc.1'), /not an X\.Y\.Z/);
    assert.throws(() => nextVersion('0.1.0', 'premajor'), /not an X\.Y\.Z/);
  });
});

describe('replaceVersion', () => {
  it('changes only the version line of the real root package.json', () => {
    const text = readFileSync(join(REPO_ROOT, 'package.json'), 'utf8');
    const out = replaceVersion(text, '9.8.7');
    const before = text.split('\n');
    const changed = out.split('\n').filter((line, i) => line !== before[i]);
    assert.deepEqual(changed, ['  "version": "9.8.7",']);
  });
});

describe('releaseUnreleased', () => {
  const intro = '# Changelog\n\nIntro.\n\n';
  const older = '## 0.1.0 — 2026-10-13\n\n### Added\n\n- Old — Thing\n';

  it('dates the Unreleased entries under the version and opens an empty Unreleased', () => {
    const changelog = `${intro}## Unreleased\n\n### Fixed\n\n- Engine — Bug\n\n${older}`;
    assert.equal(
      releaseUnreleased(changelog, '0.1.1', '2026-10-20'),
      `${intro}## Unreleased\n\n## 0.1.1 — 2026-10-20\n\n### Fixed\n\n- Engine — Bug\n\n${older}`,
    );
  });

  it('refuses an Unreleased section with no change listed', () => {
    assert.throws(
      () => releaseUnreleased(`${intro}## Unreleased\n\n${older}`, '0.1.1', '2026-10-20'),
      /lists no change/,
    );
  });

  it('refuses a changelog without an Unreleased section', () => {
    assert.throws(
      () => releaseUnreleased(`${intro}${older}`, '0.1.1', '2026-10-20'),
      /no "## Unreleased"/,
    );
  });

  it('refuses a version that already has an entry', () => {
    const changelog = `${intro}## Unreleased\n\n- New\n\n${older}`;
    assert.throws(
      () => releaseUnreleased(changelog, '0.1.0', '2026-10-20'),
      /already has an entry/,
    );
  });
});

describe('packageFiles', () => {
  it('finds the root package.json and the nine workspaces', () => {
    const files = packageFiles();
    assert.equal(files.length, 10);
    assert.equal(files[0], 'package.json');
    assert.ok(files.includes(join('packages', 'engine', 'package.json')));
  });

  it('rejects a glob it does not understand', () => {
    assert.throws(() => expandGlob('packages/**'), /Unsupported workspace glob/);
  });
});

describe('changelogChanged', () => {
  it('passes only when CHANGELOG.md is among the changed files', () => {
    assert.equal(changelogChanged(['CHANGELOG.md', 'package.json']), true);
    assert.equal(changelogChanged(['docs/CHANGELOG.md', 'package.json']), false);
  });
});
