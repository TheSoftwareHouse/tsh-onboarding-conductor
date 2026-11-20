/**
 * The release rules, with no I/O: the release branch's name, which files a release pull request may
 * change, the verdict on one, and a version's `CHANGELOG.md` section. `version-bump.cjs`,
 * `check-release.cjs` and `release-notes.cjs` do the reading and call these (ADR 0050).
 */

const { SEMVER, compare } = require('./version-bump-lib.cjs');

const OPENAPI_DOCUMENT = 'packages/shared/openapi/engine.openapi.json';
const OPENAPI_ARCHIVE = 'packages/shared/openapi/versions/';

function releaseBranch(version) {
  return `release/${version}`;
}

/** Whether `path` is one `version:bump` writes; `releaseFiles` is the `{ files, directories }` set it returns. */
function isReleaseFile(path, { files, directories }) {
  return files.includes(path) || directories.some((directory) => path.startsWith(directory));
}

/** Every reason a pull request that changed the version may not merge; empty means it may. */
function releasePullRequestProblems({
  branch,
  oldVersion,
  newVersion,
  changedFiles,
  releaseFiles,
  upToDate,
  sameRepository,
  changelog,
}) {
  const problems = [];
  if (!SEMVER.test(newVersion)) {
    problems.push(`The new version "${newVersion}" is not X.Y.Z.`);
  } else if (SEMVER.test(oldVersion) && compare(newVersion, oldVersion) <= 0) {
    problems.push(`The new version ${newVersion} is not above the current version ${oldVersion}.`);
  }
  // The notes the release workflow publishes: missing here, the run would fail after tagging.
  try {
    releaseNotes(changelog ?? '', newVersion);
  } catch (error) {
    problems.push(error.message);
  }
  // A line left here after a rebase describes code the tag ships but the release notes omit.
  if (sectionBody(changelog ?? '', 'Unreleased')) {
    problems.push(
      `"## Unreleased" in CHANGELOG.md is not empty; move its lines into the "## ${newVersion}" section.`,
    );
  }
  if (!branch.startsWith('release/')) {
    problems.push(
      `The version changed from ${oldVersion} to ${newVersion} on branch "${branch}"; only "${releaseBranch(newVersion)}" may change it.`,
    );
  } else if (branch !== releaseBranch(newVersion)) {
    problems.push(
      `Branch "${branch}" does not match the new version ${newVersion}; expected "${releaseBranch(newVersion)}".`,
    );
  }
  const outside = changedFiles.filter((file) => !isReleaseFile(file, releaseFiles));
  if (outside.length > 0) {
    problems.push(
      `A release pull request may change only the files "pnpm version:bump" writes; also changed: ${outside.join(', ')}.`,
    );
  }
  if (!sameRepository) {
    problems.push('A release pull request must come from a branch in this repository.');
  }
  if (!upToDate) {
    problems.push('The branch is behind main; rebase it onto the latest main.');
  }
  return problems;
}

/** The trimmed body of the first `## <title>` section up to the next `## ` heading, or undefined when absent. */
function sectionBody(changelog, title) {
  const lines = changelog.split('\n');
  const start = lines.findIndex(
    (line) => line.trimEnd() === `## ${title}` || line.startsWith(`## ${title} `),
  );
  if (start === -1) return undefined;
  const length = lines.slice(start + 1).findIndex((line) => line.startsWith('## '));
  return lines
    .slice(start + 1, length === -1 ? undefined : start + 1 + length)
    .join('\n')
    .trim();
}

/** The body of `## <version> — <date>` up to the next `## ` heading; throws when absent or empty. */
function releaseNotes(changelog, version) {
  const body = sectionBody(changelog, version);
  if (body === undefined) {
    throw new Error(`CHANGELOG.md has no "## ${version}" section.`);
  }
  if (body === '') {
    throw new Error(`The "## ${version}" section of CHANGELOG.md is empty.`);
  }
  return body;
}

module.exports = {
  OPENAPI_DOCUMENT,
  OPENAPI_ARCHIVE,
  releaseBranch,
  isReleaseFile,
  releasePullRequestProblems,
  releaseNotes,
};
