const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  releaseBranch,
  isReleaseFile,
  releasePullRequestProblems,
  releaseNotes,
} = require('./release-lib.cjs');

const releaseFiles = {
  files: [
    'CHANGELOG.md',
    'package.json',
    'packages/engine/package.json',
    'packages/shared/openapi/engine.openapi.json',
  ],
  directories: ['packages/shared/openapi/versions/'],
};

describe('releaseBranch', () => {
  it('names the branch after the version', () => {
    assert.equal(releaseBranch('0.2.0'), 'release/0.2.0');
  });
});

describe('isReleaseFile', () => {
  it('accepts the files version:bump writes', () => {
    assert.ok(isReleaseFile('CHANGELOG.md', releaseFiles));
    assert.ok(isReleaseFile('package.json', releaseFiles));
    assert.ok(isReleaseFile('packages/engine/package.json', releaseFiles));
    assert.ok(isReleaseFile('packages/shared/openapi/engine.openapi.json', releaseFiles));
    assert.ok(
      isReleaseFile('packages/shared/openapi/versions/0.1/engine.openapi.json', releaseFiles),
    );
  });

  it('rejects any other file', () => {
    assert.ok(!isReleaseFile('packages/engine/src/main.ts', releaseFiles));
    assert.ok(!isReleaseFile('packages/other/package.json', releaseFiles));
  });
});

describe('releasePullRequestProblems', () => {
  const clean = {
    branch: 'release/0.2.0',
    oldVersion: '0.1.2',
    newVersion: '0.2.0',
    changedFiles: ['CHANGELOG.md', 'package.json'],
    releaseFiles,
    upToDate: true,
    sameRepository: true,
    changelog:
      '# Changelog\n\n## Unreleased\n\n## 0.2.0 — 2026-11-20\n\n- a\n\n## 0.1.2 — 2026-11-01\n\n- b\n',
  };

  it('passes a clean release pull request', () => {
    assert.deepEqual(releasePullRequestProblems(clean), []);
  });

  it('flags a branch that is not a release branch', () => {
    const problems = releasePullRequestProblems({ ...clean, branch: 'feat/x' });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /only "release\/0\.2\.0" may change it/);
  });

  it('flags a release branch for another version', () => {
    const problems = releasePullRequestProblems({ ...clean, branch: 'release/0.3.0' });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /expected "release\/0\.2\.0"/);
  });

  it('flags a file outside the write set', () => {
    const problems = releasePullRequestProblems({
      ...clean,
      changedFiles: [...clean.changedFiles, 'src/a.ts'],
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /src\/a\.ts/);
  });

  it('flags a pull request from another repository', () => {
    const problems = releasePullRequestProblems({ ...clean, sameRepository: false });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /branch in this repository/);
  });

  it('flags a branch behind main', () => {
    const problems = releasePullRequestProblems({ ...clean, upToDate: false });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /behind main/);
  });

  it('flags a version that is not above the current one', () => {
    for (const newVersion of ['0.1.2', '0.1.1']) {
      const problems = releasePullRequestProblems({
        ...clean,
        branch: `release/${newVersion}`,
        newVersion,
      });
      assert.match(problems[0], new RegExp(`${newVersion.replaceAll('.', '\\.')} is not above`));
    }
  });

  it('flags a version that is not X.Y.Z', () => {
    const problems = releasePullRequestProblems({
      ...clean,
      branch: 'release/0.2.0-rc.1',
      newVersion: '0.2.0-rc.1',
    });
    assert.match(problems[0], /is not X\.Y\.Z/);
  });

  it('flags a changelog without a section for the new version', () => {
    const problems = releasePullRequestProblems({
      ...clean,
      changelog: '# Changelog\n\n## Unreleased\n\n## 0.1.2\n\n- b\n',
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /no "## 0\.2\.0" section/);
  });

  it('flags lines left under Unreleased', () => {
    const problems = releasePullRequestProblems({
      ...clean,
      changelog: '# Changelog\n\n## Unreleased\n\n- c\n\n## 0.2.0 — 2026-11-20\n\n- a\n',
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /"## Unreleased" in CHANGELOG\.md is not empty/);
  });

  it('accepts a changelog with no Unreleased heading', () => {
    const problems = releasePullRequestProblems({
      ...clean,
      changelog: '# Changelog\n\n## 0.2.0 — 2026-11-20\n\n- a\n',
    });
    assert.deepEqual(problems, []);
  });

  it('flags an empty section for the new version', () => {
    const problems = releasePullRequestProblems({
      ...clean,
      changelog: '# Changelog\n\n## 0.2.0 — 2026-11-20\n\n## 0.1.2\n\n- b\n',
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /is empty/);
  });

  it('flags a deleted changelog', () => {
    const problems = releasePullRequestProblems({ ...clean, changelog: undefined });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /no "## 0\.2\.0" section/);
  });

  it('reports every problem together', () => {
    const problems = releasePullRequestProblems({
      ...clean,
      branch: 'feat/x',
      changedFiles: ['src/a.ts'],
      upToDate: false,
      sameRepository: false,
    });
    assert.equal(problems.length, 4);
  });
});

describe('releaseNotes', () => {
  const changelog = [
    '# Changelog',
    '',
    '## Unreleased',
    '',
    '### Added',
    '',
    '- Next — Thing',
    '',
    '## 0.2.0 — 2026-11-01',
    '',
    '### Fixed',
    '',
    '- Two — Fix',
    '',
    '## 0.1.0 — 2026-10-13',
    '',
    '### Added',
    '',
    '- One — Thing',
    '',
    '## 0.0.9 — 2026-10-01',
    '',
  ].join('\n');

  it('returns a middle section without its neighbours', () => {
    assert.equal(releaseNotes(changelog, '0.2.0'), '### Fixed\n\n- Two — Fix');
  });

  it('returns the last section to the end of the file', () => {
    assert.equal(releaseNotes(changelog, '0.1.0'), '### Added\n\n- One — Thing');
  });

  it('throws when the section is missing', () => {
    assert.throws(() => releaseNotes(changelog, '9.9.9'), /no "## 9\.9\.9" section/);
  });

  it('throws when the section is empty', () => {
    assert.throws(() => releaseNotes(changelog, '0.0.9'), /is empty/);
  });
});
