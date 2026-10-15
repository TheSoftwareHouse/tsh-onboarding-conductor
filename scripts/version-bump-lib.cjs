/**
 * The pure half of `version-bump.cjs`: choosing the next version, rewriting a `package.json`'s version
 * and turning `CHANGELOG.md`'s `## Unreleased` section into the release's entry. No `fs`, no
 * `child_process`, so every rule here is testable with plain strings (`version-bump-lib.test.cjs`).
 */

const SEMVER = /^\d+\.\d+\.\d+$/;
const UNRELEASED = /^## Unreleased[ \t]*$/m;

function parse(version) {
  if (!SEMVER.test(version)) throw new Error(`"${version}" is not an X.Y.Z version`);
  return version.split('.').map(Number);
}

function compare(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** `target` is `patch`, `minor`, `major` or an explicit `X.Y.Z`, which must be above `current`. */
function nextVersion(current, target) {
  const [major, minor, patch] = parse(current);
  const next =
    target === 'major'
      ? `${major + 1}.0.0`
      : target === 'minor'
        ? `${major}.${minor + 1}.0`
        : target === 'patch'
          ? `${major}.${minor}.${patch + 1}`
          : target;
  if (compare(next, current) <= 0) {
    throw new Error(`${next} is not above the current version ${current}`);
  }
  return next;
}

/**
 * Replaces the first top-level `"version"` value in place, textually, so no other byte of the
 * `package.json` changes.
 */
function replaceVersion(text, next) {
  const pattern = /(\n {2}"version": ")[^"]*(")/;
  if (!pattern.test(text)) throw new Error('Could not find a top-level version to rewrite');
  return text.replace(pattern, `$1${next}$2`);
}

/**
 * Renames the `## Unreleased` section to `## <version> — <date>` and opens a new, empty
 * `## Unreleased` above it. Refuses when the section is missing or lists no change, or when
 * `version` already has an entry.
 */
function releaseUnreleased(changelog, version, isoDate) {
  const heading = UNRELEASED.exec(changelog);
  if (!heading) throw new Error('CHANGELOG.md has no "## Unreleased" section');
  const bodyStart = heading.index + heading[0].length;
  const nextSection = changelog.slice(bodyStart).search(/^## /m);
  const body =
    nextSection === -1
      ? changelog.slice(bodyStart)
      : changelog.slice(bodyStart, bodyStart + nextSection);
  if (!/^- /m.test(body)) throw new Error('"## Unreleased" lists no change; nothing to release');
  if (new RegExp(`^## ${version.replace(/\./g, '\\.')}(\\s|$)`, 'm').test(changelog)) {
    throw new Error(`CHANGELOG.md already has an entry for ${version}`);
  }
  return (
    changelog.slice(0, heading.index) +
    `## Unreleased\n\n## ${version} — ${isoDate}` +
    changelog.slice(bodyStart)
  );
}

module.exports = { SEMVER, nextVersion, replaceVersion, releaseUnreleased };
