const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseCommit,
  isReleaseCommit,
  nextVersion,
  renderEntry,
  prependEntry,
  hasEntry,
} = require('./release-lib.cjs');

describe('parseCommit', () => {
  it('parses a conventional subject with a scope and a PR number', () => {
    assert.deepEqual(parseCommit('feat(engine): add x (#123)', ''), {
      type: 'feat',
      scope: 'engine',
      description: 'add x',
      breaking: false,
      pr: 123,
    });
  });

  it('parses a conventional subject without a scope or a PR number', () => {
    assert.deepEqual(parseCommit('fix: repair y', ''), {
      type: 'fix',
      scope: null,
      description: 'repair y',
      breaking: false,
      pr: null,
    });
  });

  it('reads "!" before the colon as breaking', () => {
    const commit = parseCommit('refactor(api)!: drop route (#5)', '');
    assert.equal(commit.breaking, true);
    assert.equal(commit.type, 'refactor');
    assert.equal(commit.description, 'drop route');
  });

  it('reads a BREAKING CHANGE footer in the body as breaking', () => {
    const body = '* change a\n* change b\n\nBREAKING CHANGE: the route is gone\n';
    assert.equal(parseCommit('feat: x (#1)', body).breaking, true);
    assert.equal(parseCommit('feat: x (#1)', 'BREAKING-CHANGE: hyphenated').breaking, true);
    assert.equal(parseCommit('feat: x (#1)', 'mentions BREAKING CHANGE: mid-line').breaking, false);
  });

  it('treats a non-conventional subject as type null and keeps the PR number', () => {
    assert.deepEqual(parseCommit('Feat/veriff kyc connector (#92)', ''), {
      type: null,
      scope: null,
      description: 'Feat/veriff kyc connector',
      breaking: false,
      pr: 92,
    });
  });
});

describe('isReleaseCommit', () => {
  it('matches only the release commit prefix', () => {
    assert.equal(isReleaseCommit('chore(release): v0.0.2 [skip ci]'), true);
    assert.equal(isReleaseCommit('chore: tidy'), false);
    assert.equal(isReleaseCommit('feat(release): x'), false);
  });

  it('does not match a human PR title that starts with chore(release):', () => {
    assert.equal(isReleaseCommit('chore(release): 1.0.0 (#130)'), false);
    assert.equal(isReleaseCommit('chore(release): v1.0.0'), false);
    assert.equal(isReleaseCommit('chore(release): v1.0.0 [skip ci] extra'), false);
  });
});

describe('nextVersion', () => {
  const fix = parseCommit('fix: a', '');
  const feat = parseCommit('feat: a', '');
  const breaking = parseCommit('feat!: a', '');

  it('bumps the patch for a fix', () => {
    assert.equal(nextVersion('0.0.1', [fix]), '0.0.2');
  });

  it('does not bump the minor for a feat and carries past a single digit', () => {
    assert.equal(nextVersion('0.0.9', [feat]), '0.0.10');
  });

  it('bumps the minor for a breaking change while the major is 0', () => {
    assert.equal(nextVersion('0.0.5', [fix, breaking]), '0.1.0');
  });

  it('bumps the major for a breaking change from 1.0.0 on', () => {
    assert.equal(nextVersion('1.2.3', [breaking]), '2.0.0');
  });
});

describe('renderEntry', () => {
  it('escapes < in descriptions and scopes', () => {
    const entry = renderEntry('0.1.0', '2026-10-13', [
      parseCommit('fix(<b>): handle <script> tags', ''),
    ]);
    assert.match(entry, /- &lt;b> — Handle &lt;script> tags/);
    assert.doesNotMatch(entry, /</);
  });

  const commits = [
    parseCommit('docs: first other (#1)', ''),
    parseCommit('fix(engine): first fix (#2)', ''),
    parseCommit('feat(panel): first feature (#3)', ''),
    parseCommit('Plain title (#4)', ''),
    parseCommit('feat(api)!: breaking one (#5)', ''),
    parseCommit('fix: second fix', ''),
  ];

  it('groups into Added, Changed and Fixed, keeps input order and links no pull request', () => {
    assert.equal(
      renderEntry('0.1.0', '2026-10-13', commits),
      [
        '## 0.1.0 — 2026-10-13',
        '',
        '### Added',
        '',
        '- Panel — First feature',
        '- **Breaking:** Api — Breaking one',
        '',
        '### Changed',
        '',
        '- First other',
        '- Plain title',
        '',
        '### Fixed',
        '',
        '- Engine — First fix',
        '- Second fix',
        '',
      ].join('\n'),
    );
  });

  it('omits empty groups', () => {
    const entry = renderEntry('0.0.2', '2026-10-13', [parseCommit('fix: only (#9)', '')]);
    assert.equal(entry.includes('### Added'), false);
    assert.equal(entry.includes('### Changed'), false);
    assert.equal(entry.includes('### Fixed'), true);
  });
});

describe('prependEntry', () => {
  const entry = '## 0.0.2 — 2026-10-14\n\n### Fixed\n\n- b\n';

  it('inserts before the first existing entry, after the intro', () => {
    const changelog = '# Changelog\n\nIntro.\n\n## 0.0.1 — 2026-10-13\n\n- a\n';
    assert.equal(
      prependEntry(changelog, entry),
      '# Changelog\n\nIntro.\n\n## 0.0.2 — 2026-10-14\n\n### Fixed\n\n- b\n\n## 0.0.1 — 2026-10-13\n\n- a\n',
    );
  });

  it('appends to an intro-only file', () => {
    assert.equal(
      prependEntry('# Changelog\n\nIntro.\n', entry),
      '# Changelog\n\nIntro.\n\n## 0.0.2 — 2026-10-14\n\n### Fixed\n\n- b\n',
    );
  });
});

describe('hasEntry', () => {
  const changelog = '# Changelog\n\n## 0.0.10 — 2026-10-13\n\n- a\n\n## 0.1.0\n';

  it('matches a version heading exactly, with or without a date', () => {
    assert.equal(hasEntry(changelog, '0.0.10'), true);
    assert.equal(hasEntry(changelog, '0.1.0'), true);
  });

  it('does not match a prefix or another version', () => {
    assert.equal(hasEntry(changelog, '0.0.1'), false);
    assert.equal(hasEntry(changelog, '0.1'), false);
  });
});
