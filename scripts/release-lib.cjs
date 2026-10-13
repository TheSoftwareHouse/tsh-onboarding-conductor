/**
 * The pure half of the release script: parsing squash-merge subjects, choosing the next version and
 * rendering CHANGELOG entries. No `fs`, no `child_process` — `release.cjs` does the I/O — so every rule
 * here is testable with plain strings (`release-lib.test.cjs`).
 *
 * A squash merge's subject is the PR title, which CONTRIBUTING.md requires to be a Conventional
 * Commit. A title that is not one still releases; it lands under "Other changes".
 */

const CONVENTIONAL_SUBJECT = /^([A-Za-z]+)(?:\(([^)]*)\))?(!)?: (.+)$/;
const TRAILING_PR = /\s*\(#(\d+)\)\s*$/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;
// Only the bot's own subject: a human PR titled `chore(release): 1.0.0 (#130)` is a normal change.
const RELEASE_SUBJECT = /^chore\(release\): v\d+\.\d+\.\d+ \[skip ci\]$/;

/** @returns {{ type: string | null, scope: string | null, description: string, breaking: boolean, pr: number | null }} */
function parseCommit(subject, body = '') {
  const prMatch = TRAILING_PR.exec(subject);
  const pr = prMatch ? Number(prMatch[1]) : null;
  const withoutPr = prMatch ? subject.slice(0, prMatch.index) : subject;

  const conventional = CONVENTIONAL_SUBJECT.exec(withoutPr);
  const breakingFooter = BREAKING_FOOTER.test(body);

  if (!conventional) {
    return {
      type: null,
      scope: null,
      description: withoutPr.trim(),
      breaking: breakingFooter,
      pr,
    };
  }

  const [, type, scope, bang, description] = conventional;
  return {
    type: type.toLowerCase(),
    scope: scope ? scope : null,
    description: description.trim(),
    breaking: bang === '!' || breakingFooter,
    pr,
  };
}

function isReleaseCommit(subject) {
  return RELEASE_SUBJECT.test(subject);
}

/** Patch per release; a breaking change bumps minor while the major is 0, major from 1.0.0 on. */
function nextVersion(current, parsedCommits) {
  const [major, minor, patch] = current.split('.').map(Number);
  const breaking = parsedCommits.some((commit) => commit.breaking);
  if (breaking && major === 0) return `${major}.${minor + 1}.0`;
  if (breaking) return `${major + 1}.0.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const GROUPS = [
  { title: 'Breaking changes', includes: (commit) => commit.breaking },
  { title: 'Features', includes: (commit) => commit.type === 'feat' },
  { title: 'Fixes', includes: (commit) => commit.type === 'fix' },
  { title: 'Other changes', includes: () => true },
];

/** Titles are untrusted text rendered into Markdown: `<` could open raw HTML. */
function escapeHtml(text) {
  return text.replace(/</g, '&lt;');
}

function renderLine(commit, repoUrl) {
  const scope = commit.scope ? `**${escapeHtml(commit.scope)}:** ` : '';
  const link = commit.pr ? ` ([#${commit.pr}](${repoUrl}/pull/${commit.pr}))` : '';
  return `- ${scope}${escapeHtml(commit.description)}${link}`;
}

/** Each commit lands in the first group that claims it; commits keep the order they were given. */
function renderEntry(version, isoDate, parsedCommits, repoUrl) {
  const remaining = [...parsedCommits];
  const sections = [];
  for (const group of GROUPS) {
    const members = remaining.filter(group.includes);
    if (members.length === 0) continue;
    for (const member of members) remaining.splice(remaining.indexOf(member), 1);
    const lines = members.map((commit) => renderLine(commit, repoUrl));
    sections.push(`### ${group.title}\n\n${lines.join('\n')}`);
  }
  return [`## ${version} — ${isoDate}`, ...sections].join('\n\n') + '\n';
}

/** Inserts the entry after the file's intro and before the first existing entry. */
function prependEntry(changelog, entry) {
  const firstEntry = changelog.search(/^## /m);
  if (firstEntry === -1) return `${changelog.trimEnd()}\n\n${entry}`;
  return `${changelog.slice(0, firstEntry)}${entry}\n${changelog.slice(firstEntry)}`;
}

function hasEntry(changelog, version) {
  const escaped = version.replace(/\./g, '\\.');
  return new RegExp(`^## ${escaped}(\\s|$)`, 'm').test(changelog);
}

module.exports = {
  parseCommit,
  isReleaseCommit,
  nextVersion,
  renderEntry,
  prependEntry,
  hasEntry,
};
