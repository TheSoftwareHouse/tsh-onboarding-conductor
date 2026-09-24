#!/usr/bin/env node

/**
 * The reminder that a changed skill still owes its golden set a run.
 *
 * The golden sets (`pnpm skills:evals`) spend a model's time on the machine's own signed-in Claude
 * Code account and have no CI workflow: nothing outside this checkout will ever notice a skill that
 * was changed and never evaluated. This script is what notices. It is wired as two hooks in
 * `.claude/settings.json`, so the harness runs it rather than the model remembering to:
 *
 * - `post-tool-use` — an edit to a file under `.claude/skills/` returns the command for that skill
 *   as context, while the change is still the thing being worked on.
 * - `stop` — before a turn ends, git decides. Every skill with uncommitted changes under
 *   `.claude/skills/` blocks the stop once, naming the command; a second stop at the same state
 *   stays silent, so the reminder cannot loop and cannot nag a decision already taken.
 *
 * Git is the signal because it is the only durable one: reports are gitignored, so their absence
 * says nothing about whether a run happened, and their presence says nothing about which state of
 * which skill it graded. The fingerprint is the content of the changed files, so a further edit
 * after a reminder earns another one, and rerunning the suite — which changes nothing tracked —
 * does not.
 *
 * Inside an eval sandbox the hooks are removed from the copied settings (`createSandbox` in
 * `skill-eval-runner.cjs`) and `SKILL_EVALS_SANDBOX` is set in the child's environment; either one
 * alone is enough to keep the agent under test from being reminded — or, for a `stop` block, kept
 * from ever finishing.
 *
 * Exit codes are the hook contract's: 0 with JSON on stdout, whatever the decision. A failure here
 * must never end a turn, so anything unexpected — no git, an unreadable state file — is silence.
 */

const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { mkdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, relative, resolve } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');
const SKILLS_DIRECTORY = '.claude/skills';
const SKILLS_PREFIX = `${SKILLS_DIRECTORY}/`;

/**
 * One state file per session and checkout, outside the repository so it never shows up as a change
 * of its own. Losing it — a cleared temporary directory, a new session — costs one extra reminder,
 * which is the failure this whole script prefers.
 */
const STATE_ROOT = join(tmpdir(), 'tsh-skill-evals-reminder');

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const STATE_KEY_LENGTH = 32;

/** The skill a repository-relative path belongs to, or `undefined` for a path outside the skills. */
function skillOf(path) {
  const normalized = path.replace(/\\/g, '/');
  const repoRelative = normalized.startsWith('/')
    ? relative(REPO_ROOT, normalized).replace(/\\/g, '/')
    : normalized.replace(/^\.\//, '');

  if (!repoRelative.startsWith(SKILLS_PREFIX)) {
    return undefined;
  }

  const [name] = repoRelative.slice(SKILLS_PREFIX.length).split('/');

  return name === undefined || name === '' ? undefined : name;
}

/** The skills named by a list of paths, each once, in a stable order. */
function skillsForPaths(paths) {
  const skills = new Set();

  for (const path of paths) {
    if (typeof path !== 'string' || path === '') {
      continue;
    }

    const skill = skillOf(path);

    if (skill !== undefined) {
      skills.add(skill);
    }
  }

  return [...skills].sort();
}

/**
 * `git status --porcelain=v1 -z` entries. A rename or copy is followed by its other path, which is
 * the same change rather than a second one, so that token is consumed with it.
 */
function parsePorcelain(stdout) {
  const tokens = stdout.split('\0');
  const entries = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.length < 4) {
      continue;
    }

    const status = token.slice(0, 2);

    if (status[0] === 'R' || status[0] === 'C') {
      index += 1;
    }

    entries.push({ status: status.trim(), path: token.slice(3) });
  }

  return entries;
}

function contentDigest(root, path) {
  const absolute = join(root, path);

  try {
    return statSync(absolute).isFile()
      ? createHash('sha256').update(readFileSync(absolute)).digest('hex')
      : 'not-a-file';
  } catch {
    return 'gone';
  }
}

/**
 * What git sees under `.claude/skills/`: the skills with uncommitted changes and a fingerprint of
 * the exact content of those changes. A repository git cannot read reports nothing, which reads as
 * "no skill changed" and blocks nothing.
 */
function collectSkillChanges(root = REPO_ROOT) {
  let stdout;

  try {
    stdout = execFileSync(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', SKILLS_DIRECTORY],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return { skills: [], fingerprint: undefined };
  }

  const entries = parsePorcelain(stdout)
    .filter((entry) => skillOf(entry.path) !== undefined)
    .sort((left, right) => left.path.localeCompare(right.path));

  if (entries.length === 0) {
    return { skills: [], fingerprint: undefined };
  }

  const digest = createHash('sha256');

  for (const entry of entries) {
    digest.update(`${entry.status}\0${entry.path}\0${contentDigest(root, entry.path)}\0`);
  }

  return {
    skills: skillsForPaths(entries.map((entry) => entry.path)),
    fingerprint: digest.digest('hex'),
  };
}

function commandFor(skills) {
  return skills.map((skill) => `\`pnpm skills:evals --case ${skill}\``).join(' and ');
}

/** The one text both hooks carry, so the reminder reads the same wherever it arrives. */
function reminder(skills) {
  const subject =
    skills.length === 1
      ? `The \`${skills[0]}\` skill changed`
      : `${skills.length} skills changed (${skills.map((skill) => `\`${skill}\``).join(', ')})`;

  return [
    `${subject}. This repository evaluates its skills here, on this machine — no CI workflow does.`,
    `Run ${commandFor(skills)} and report the verdict; run the whole suite (\`pnpm skills:evals\`) before opening a pull request.`,
    'The suite uses the signed-in Claude Code account — never an API key, never CI — and takes a few minutes per case.',
  ].join(' ');
}

/**
 * Whether this stop is the one to remind on. `stopHookActive` means the turn is already continuing
 * because of a stop hook, and a reminder that fires again there is a loop rather than a reminder.
 */
function stopDecision({ changes, previousFingerprint, stopHookActive }) {
  if (stopHookActive === true || changes.fingerprint === undefined) {
    return { block: false };
  }

  if (changes.fingerprint === previousFingerprint) {
    return { block: false, fingerprint: changes.fingerprint };
  }

  return {
    block: true,
    fingerprint: changes.fingerprint,
    reason: [
      reminder(changes.skills),
      'If the user has said not to spend a run on this change, say so and stop — this reminder does not repeat while these files stay as they are.',
    ].join(' '),
  };
}

function stateFileFor(sessionId) {
  const key = createHash('sha256')
    .update(`${REPO_ROOT}\0${typeof sessionId === 'string' ? sessionId : 'no-session'}`)
    .digest('hex')
    .slice(0, STATE_KEY_LENGTH);

  return join(STATE_ROOT, `${key}.json`);
}

function readFingerprint(file) {
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'));

    return typeof state.fingerprint === 'string' ? state.fingerprint : undefined;
  } catch {
    return undefined;
  }
}

function writeFingerprint(file, fingerprint) {
  try {
    mkdirSync(STATE_ROOT, { recursive: true });
    writeFileSync(file, `${JSON.stringify({ fingerprint })}\n`);
  } catch {
    // A state file that cannot be written costs a repeated reminder, never a failed hook.
  }
}

function readHookInput() {
  try {
    const raw = readFileSync(0, 'utf8');

    return raw.trim() === '' ? {} : JSON.parse(raw);
  } catch {
    return {};
  }
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function postToolUse(input) {
  const skills = skillsForPaths([
    input?.tool_input?.file_path,
    input?.tool_input?.notebook_path,
    input?.tool_response?.filePath,
  ]);

  if (skills.length > 0) {
    emit({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: reminder(skills),
      },
    });
  }

  return EXIT_OK;
}

function stop(input) {
  const file = stateFileFor(input?.session_id);
  const decision = stopDecision({
    changes: collectSkillChanges(),
    previousFingerprint: readFingerprint(file),
    stopHookActive: input?.stop_hook_active,
  });

  if (decision.fingerprint !== undefined) {
    writeFingerprint(file, decision.fingerprint);
  }

  if (decision.block) {
    emit({ decision: 'block', reason: decision.reason });
  }

  return EXIT_OK;
}

function main(argv) {
  // The agent under test must not be reminded of the suite it is the subject of.
  if (process.env.SKILL_EVALS_SANDBOX === '1') {
    return EXIT_OK;
  }

  const mode = argv[0];

  if (mode === 'post-tool-use') {
    return postToolUse(readHookInput());
  }

  if (mode === 'stop') {
    return stop(readHookInput());
  }

  console.error('Usage: node scripts/skill-evals-reminder.cjs <post-tool-use|stop>');

  return EXIT_USAGE;
}

module.exports = {
  collectSkillChanges,
  parsePorcelain,
  reminder,
  skillOf,
  skillsForPaths,
  stopDecision,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
