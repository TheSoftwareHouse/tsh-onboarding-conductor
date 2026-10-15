/**
 * The pure half of the release script: parsing squash-merge subjects, choosing the next version and
 * rendering CHANGELOG entries. No `fs`, no `child_process` — `release.cjs` does the I/O — so every rule
 * here is testable with plain strings (`release-lib.test.cjs`).
 *
 * A squash merge's subject is the PR title, which CONTRIBUTING.md requires to be a Conventional
 * Commit. A title that is not one still releases; it lands under "Changed".
 *
 * Entries follow Keep a Changelog (keepachangelog.com): an Added / Changed / Fixed section each, one
 * short line per change and no pull request links.
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

// Keep a Changelog's order. A breaking change stays in its type's section, marked on its line.
const GROUPS = [
  { title: 'Added', includes: (commit) => commit.type === 'feat' },
  { title: 'Changed', includes: (commit) => commit.type !== 'feat' && commit.type !== 'fix' },
  { title: 'Fixed', includes: (commit) => commit.type === 'fix' },
];

/** Titles are untrusted text rendered into Markdown: `<` could open raw HTML. */
function escapeHtml(text) {
  return text.replace(/</g, '&lt;');
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `- Scope — Description`, the scope omitted when the title has none. */
function renderLine(commit) {
  const breaking = commit.breaking ? '**Breaking:** ' : '';
  const topic = commit.scope ? `${capitalize(escapeHtml(commit.scope))} — ` : '';
  return `- ${breaking}${topic}${capitalize(escapeHtml(commit.description))}`;
}

/** Empty sections are left out; commits keep the order they were given. */
function renderEntry(version, isoDate, parsedCommits) {
  const sections = [];
  for (const group of GROUPS) {
    const members = parsedCommits.filter(group.includes);
    if (members.length === 0) continue;
    sections.push(`### ${group.title}\n\n${members.map(renderLine).join('\n')}`);
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
