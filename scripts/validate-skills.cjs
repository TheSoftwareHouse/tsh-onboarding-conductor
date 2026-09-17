#!/usr/bin/env node

/**
 * Validates the agent context checked into `.claude/` — the skills under `.claude/skills/` and the
 * path-scoped rules under `.claude/rules/` — without invoking a model.
 *
 * A skill is prose, so nothing type-checks it and nothing fails when it goes stale. The decay is
 * always the same shape: the skill keeps citing a command that was renamed, a file that moved or a
 * reference document nobody reads any more, and the model follows it into a dead end. Every check
 * below is a fact about the repository that a reader could verify by hand and never does.
 *
 * This is the deterministic layer only. Whether a skill changes what the model produces is a
 * different question with a different answer — see `scripts/test-skill-ablation.cjs`, which
 * measures it, and `scripts/test-skill-routing.cjs`, which measures whether the skill is found at
 * all. Neither of those can run here: both need a model, and this must stay fast enough to sit in
 * the pre-commit hook.
 *
 * Usage:
 *   pnpm skills:validate                                     # every skill and rule
 *   pnpm skills:validate --strict                             # warnings fail too
 *   pnpm skills:validate .claude/skills/creating-workflows    # one skill
 *   pnpm skills:validate .claude/rules/testing.md             # one rule
 */

const { execFileSync } = require('node:child_process');
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { join, relative, resolve, sep } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');

const SKILLS_DIR = join(REPO_ROOT, '.claude/skills');
const RULES_DIR = join(REPO_ROOT, '.claude/rules');

/**
 * Frontmatter keys a skill may declare. `name` and `description` are what Claude Code itself reads;
 * `when_to_use` is this repository's own convention, carrying the trigger phrases that decide
 * whether the skill is reached for at all. An unknown key is a warning, not a failure — the harness
 * ignores what it does not know, and a typo'd key is the thing worth surfacing.
 */
const REQUIRED_SKILL_KEYS = ['name', 'description', 'when_to_use'];
const KNOWN_SKILL_KEYS = [...REQUIRED_SKILL_KEYS, 'allowed-tools', 'license', 'version'];

/**
 * A skill's `description` and `when_to_use` are loaded into every session that has the skill
 * available, whether or not it fires, so their length is a standing tax. The harness presents them
 * as one line, so the soft cap — where the tax stops being obviously worth paying — is measured
 * against the pair. Measuring `description` alone hides most of the cost: the skills here run
 * around 400 characters of description against 400 more of `when_to_use`, so each one is
 * comfortably under a 600-character cap while actually costing 900.
 *
 * The hard cap stays on `description` alone, because it is the field the harness truncates.
 */
const DESCRIPTION_SOFT_LIMIT = 600;
const DESCRIPTION_HARD_LIMIT = 1024;

/** `CLAUDE.md` holds itself to 200 lines. A skill body earns no more latitude than that. */
const SKILL_LINE_BUDGET = 200;

/** pnpm's own verbs, which are not scripts and must not be looked up as one. */
const PNPM_BUILTINS = new Set([
  'add',
  'audit',
  'dlx',
  'exec',
  'install',
  'link',
  'list',
  'outdated',
  'prune',
  'remove',
  'run',
  'store',
  'update',
  'why',
]);

/** Extensions that make a backticked token a claim about a file rather than a word in prose. */
const PATH_EXTENSIONS = [
  '.cjs',
  '.dist',
  '.json',
  '.md',
  '.mjs',
  '.sh',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
];

const FAIL = 'fail';
const WARN = 'warn';

/**
 * Reads the leading `---` block. Values are scalars or a list of scalars, which is all the skills
 * and rules in this repository use, so a real YAML parser would be a dependency bought for nothing.
 * A value that spans lines or nests is reported as unparseable rather than guessed at.
 */
function parseFrontmatter(contents) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contents);

  if (match === null) {
    return { ok: false, detail: 'no frontmatter block' };
  }

  const values = {};
  let listKey;

  for (const line of match[1].split('\n')) {
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
      continue;
    }

    const listItem = /^\s+-\s*(.*)$/.exec(line);

    if (listItem !== null) {
      if (listKey === undefined) {
        return { ok: false, detail: 'list item outside any key' };
      }
      values[listKey].push(unquote(listItem[1]));
      continue;
    }

    const assignment = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);

    if (assignment === null) {
      return { ok: false, detail: `unparseable line: ${line.trim().slice(0, 60)}` };
    }

    const [, key, rawValue] = assignment;

    if (rawValue.trim().length === 0) {
      listKey = key;
      values[key] = [];
      continue;
    }

    listKey = undefined;
    values[key] = unquote(rawValue);
  }

  return { ok: true, values };
}

function unquote(value) {
  return value
    .trim()
    .replace(/^(['"])([\s\S]*)\1$/, '$2')
    .trim();
}

/**
 * Every file git tracks, with the directories they imply. Tracked files rather than a directory
 * walk, so build output, `node_modules` and anything else gitignored cannot satisfy a citation —
 * a skill pointing at a path that only exists on the author's machine is exactly the defect this
 * script is looking for.
 */
function collectTrackedPaths() {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const files = new Set(output.split('\0').filter((path) => path.length > 0));
  const directories = new Set();

  for (const file of files) {
    const segments = file.split('/');

    for (let depth = 1; depth < segments.length; depth += 1) {
      directories.add(segments.slice(0, depth).join('/'));
    }
  }

  return { files, directories };
}

/** Workspace package name to its manifest, the way pnpm resolves `--filter`. */
function collectWorkspacePackages() {
  const packages = new Map();
  const roots = [join(REPO_ROOT, 'packages'), join(REPO_ROOT, 'packages/shared')];

  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }

    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const manifestPath = join(root, entry.name, 'package.json');

      if (!entry.isDirectory() || !existsSync(manifestPath)) {
        continue;
      }

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

      if (typeof manifest.name === 'string') {
        packages.set(manifest.name, manifest);
      }
    }
  }

  return packages;
}

function getRootScripts() {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).scripts ?? {};
}

/**
 * The backticked spans on one line. Claims about the repository — commands to run, files to open —
 * are written in backticks in these documents and prose is not, so this is what separates a
 * checkable assertion from a sentence that merely mentions a word.
 */
function collectCodeSpans(line) {
  return [...line.matchAll(/`([^`\n]+)`/g)].map((match) => match[1].trim());
}

/**
 * Checks one `pnpm ...` span against the scripts that exist. A skill naming a command the
 * repository dropped sends the model into a failure it cannot diagnose, because the error comes
 * back from pnpm rather than from anything the skill talks about.
 */
function findCommandProblem(span, context) {
  const tokens = span.split(/\s+/).slice(1);

  if (tokens.length === 0) {
    return undefined;
  }

  if (tokens[0] === '--filter') {
    const [, packageName, scriptName] = tokens;
    const manifest = context.packages.get(packageName);

    if (manifest === undefined) {
      return `no workspace package named ${packageName}`;
    }

    if (scriptName === undefined || PNPM_BUILTINS.has(scriptName)) {
      return undefined;
    }

    return (manifest.scripts ?? {})[scriptName] === undefined
      ? `${packageName} has no script "${scriptName}"`
      : undefined;
  }

  // A flag rather than a script name — `pnpm -r --if-present` names how pnpm runs, not what it
  // runs, and there is nothing to look up.
  if (tokens[0].startsWith('-') || PNPM_BUILTINS.has(tokens[0])) {
    return undefined;
  }

  return context.rootScripts[tokens[0]] === undefined ? `no root script "${tokens[0]}"` : undefined;
}

/**
 * Whether a span is a claim that a path exists. Placeholders (`<id>.workflow.json`), globs and
 * anything carrying shell syntax name a shape rather than a file, and asserting on those would fail
 * the documents that are teaching a pattern — which is most of them.
 */
function looksLikePath(span) {
  if (!span.includes('/') || /[<>*?$|\s]/.test(span)) {
    return false;
  }

  if (span.startsWith('http://') || span.startsWith('https://') || span.startsWith('@')) {
    return false;
  }

  return span.endsWith('/') || PATH_EXTENSIONS.some((extension) => span.endsWith(extension));
}

/**
 * Resolves a cited path against the tracked tree. A skill cites both ways — `workflows/fixtures/`
 * from the repository root in one paragraph and `fixtures/base-typed.workflow.json` from inside
 * that directory in the next — so a suffix match counts. What matters is that the citation
 * identifies something real, not that it was written from the root.
 */
function findPathProblem(span, tracked) {
  const candidate = span.replace(/^\.\//, '').replace(/\/$/, '');
  const pool = span.endsWith('/') ? tracked.directories : tracked.files;
  const opposite = span.endsWith('/') ? tracked.files : tracked.directories;

  if (pool.has(candidate)) {
    return undefined;
  }

  const suffix = `/${candidate}`;

  for (const path of pool) {
    if (path.endsWith(suffix)) {
      return undefined;
    }
  }

  // Resolving in the other pool means the path is real and the citation misdescribes it, which a
  // reader following the skill hits immediately — a directory where a file was promised.
  if (opposite.has(candidate) || [...opposite].some((path) => path.endsWith(suffix))) {
    return {
      severity: FAIL,
      message: span.endsWith('/')
        ? `${span} is a file, cited as a directory`
        : `${span} is a directory, cited as a file`,
    };
  }

  // A skill prescribes as much as it describes: `packages/demo-bff/CLAUDE.md` is a file the
  // creating-engine-bffs skill instructs an agent to add, not one it expects to find. Nothing in
  // the prose distinguishes that from a citation gone stale, so this is a warning a human reads,
  // and `--strict` is there for a run that wants it to bite.
  return { severity: WARN, message: `path does not exist: ${span}` };
}

function collectSkillDirectories() {
  if (!existsSync(SKILLS_DIR)) {
    return [];
  }

  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(SKILLS_DIR, entry.name))
    .sort();
}

function collectReferenceFiles(skillDirectory) {
  const referencesDirectory = join(skillDirectory, 'references');

  if (!existsSync(referencesDirectory)) {
    return [];
  }

  return readdirSync(referencesDirectory)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => join(referencesDirectory, name));
}

function validateSkill(skillDirectory, context) {
  const findings = [];
  const skillName = relative(SKILLS_DIR, skillDirectory);
  const skillFile = join(skillDirectory, 'SKILL.md');

  if (!existsSync(skillFile)) {
    return { findings: [{ severity: FAIL, message: 'no SKILL.md' }], name: skillName };
  }

  const contents = readFileSync(skillFile, 'utf8');
  const frontmatter = parseFrontmatter(contents);

  if (!frontmatter.ok) {
    return {
      findings: [{ severity: FAIL, message: `frontmatter: ${frontmatter.detail}` }],
      name: skillName,
    };
  }

  const { values } = frontmatter;

  for (const key of REQUIRED_SKILL_KEYS) {
    if (typeof values[key] !== 'string' || values[key].length === 0) {
      findings.push({ severity: FAIL, message: `frontmatter is missing "${key}"` });
    }
  }

  for (const key of Object.keys(values)) {
    if (!KNOWN_SKILL_KEYS.includes(key)) {
      findings.push({ severity: WARN, message: `unknown frontmatter key "${key}"` });
    }
  }

  if (values.name !== undefined && values.name !== skillName) {
    findings.push({
      severity: FAIL,
      message: `frontmatter name "${values.name}" does not match directory "${skillName}"`,
    });
  }

  if (
    typeof values.description === 'string' &&
    values.description.length > DESCRIPTION_HARD_LIMIT
  ) {
    findings.push({
      severity: FAIL,
      message: `description is ${values.description.length} characters, past the ${DESCRIPTION_HARD_LIMIT} the harness keeps`,
    });
  }

  const preloaded = ['description', 'when_to_use']
    .map((key) => (typeof values[key] === 'string' ? values[key].length : 0))
    .reduce((total, length) => total + length, 0);

  if (preloaded > DESCRIPTION_SOFT_LIMIT) {
    findings.push({
      severity: WARN,
      message: `description and when_to_use are ${preloaded} characters together, over ${DESCRIPTION_SOFT_LIMIT}; every session pays for them whether the skill fires or not`,
    });
  }

  const bodyLines = contents.split('\n').length;

  if (bodyLines > SKILL_LINE_BUDGET) {
    findings.push({
      severity: WARN,
      message: `SKILL.md is ${bodyLines} lines, over the ${SKILL_LINE_BUDGET}-line budget`,
    });
  }

  // Citations pool across the skill and its references: a reference document may be reached only
  // from another one, and that is still reached.
  const referenceFiles = collectReferenceFiles(skillDirectory);
  const citedReferences = new Set();

  for (const documentPath of [skillFile, ...referenceFiles]) {
    const documentLabel = relative(skillDirectory, documentPath);
    const documentContents = readFileSync(documentPath, 'utf8');
    let insideFence = false;

    documentContents.split('\n').forEach((line, index) => {
      if (line.trimStart().startsWith('```')) {
        insideFence = !insideFence;
        return;
      }

      for (const link of line.matchAll(/\]\((references\/[^)\s]+\.md)\)/g)) {
        citedReferences.add(join(skillDirectory, link[1]));
      }

      if (insideFence) {
        return;
      }

      const at = `${documentLabel}:${index + 1}`;

      for (const span of collectCodeSpans(line)) {
        if (span.startsWith('pnpm ')) {
          const problem = findCommandProblem(span, context);

          if (problem !== undefined) {
            findings.push({ severity: FAIL, message: `${at}: ${problem} (\`${span}\`)` });
          }

          continue;
        }

        if (!looksLikePath(span)) {
          continue;
        }

        // A reference is cited relative to the skill directory, so it resolves against that rather
        // than against the repository root, and it either exists or the instruction is broken.
        if (span.startsWith('references/')) {
          const referencePath = join(skillDirectory, span);

          citedReferences.add(referencePath);

          if (!existsSync(referencePath)) {
            findings.push({ severity: FAIL, message: `${at}: no such reference: ${span}` });
          }

          continue;
        }

        const problem = findPathProblem(span, context.tracked);

        if (problem !== undefined) {
          findings.push({ severity: problem.severity, message: `${at}: ${problem.message}` });
        }
      }
    });
  }

  for (const referenceFile of referenceFiles) {
    if (!citedReferences.has(referenceFile)) {
      findings.push({
        severity: FAIL,
        message: `${relative(skillDirectory, referenceFile)} is never cited, so nothing will ever open it`,
      });
    }
  }

  return {
    findings: dedupe(findings),
    name: skillName,
    declaredName: values.name,
    detail: `${bodyLines} lines, ${referenceFiles.length} references`,
  };
}

function dedupe(findings) {
  const seen = new Set();

  return findings.filter((finding) => {
    const key = `${finding.severity}:${finding.message}`;
    const isNew = !seen.has(key);

    seen.add(key);

    return isNew;
  });
}

/**
 * Claude Code expands a glob's brace groups into separate patterns before matching any file, so
 * one ending in `.{ts,tsx}` is two patterns rather than one pattern holding literal braces. Expand
 * the same way here. A glob whose braces do not balance expands to itself, leaving them literal —
 * the same thing the matcher does with it.
 */
function expandBraces(glob) {
  const open = glob.indexOf('{');

  if (open === -1) {
    return [glob];
  }

  const alternatives = [];
  let start = open + 1;
  let depth = 0;

  for (let index = open; index < glob.length; index += 1) {
    const character = glob[index];

    if (character === '{') {
      depth += 1;
    } else if (character === ',' && depth === 1) {
      alternatives.push(glob.slice(start, index));
      start = index + 1;
    } else if (character === '}') {
      depth -= 1;

      if (depth === 0) {
        alternatives.push(glob.slice(start, index));

        // A nested group is expanded by re-expanding each substituted result.
        return alternatives.flatMap((alternative) =>
          expandBraces(`${glob.slice(0, open)}${alternative}${glob.slice(index + 1)}`),
        );
      }
    }
  }

  return [glob];
}

/**
 * Converts a rule's `paths:` glob into the expression Claude Code's matcher applies: `**` crosses
 * directories, `*` stays inside one segment. Expand brace groups with `expandBraces` first.
 */
function globToRegExp(glob) {
  let source = '';

  for (let index = 0; index < glob.length; index += 1) {
    const rest = glob.slice(index);

    if (rest.startsWith('**/')) {
      source += '(?:[^/]*/)*';
      index += 2;
    } else if (rest.startsWith('**')) {
      source += '.*';
      index += 1;
    } else if (rest.startsWith('*')) {
      source += '[^/]*';
    } else if (rest.startsWith('?')) {
      source += '[^/]';
    } else {
      source += glob[index].replace(/[.+^${}()|[\]\\]/, '\\$&');
    }
  }

  return new RegExp(`^${source}$`);
}

/**
 * A rule loads when a file it names is read. One whose globs match nothing is inert — it costs a
 * file in the repository and reaches no session — and that is invisible without checking.
 */
function validateRule(rulePath, tracked) {
  const frontmatter = parseFrontmatter(readFileSync(rulePath, 'utf8'));

  if (!frontmatter.ok) {
    return { findings: [{ severity: FAIL, message: `frontmatter: ${frontmatter.detail}` }] };
  }

  const globs = frontmatter.values.paths;

  if (!Array.isArray(globs) || globs.length === 0) {
    return {
      findings: [{ severity: FAIL, message: 'frontmatter has no "paths" list, so it never loads' }],
    };
  }

  const findings = globs
    .filter((glob) => {
      const patterns = expandBraces(glob).map(globToRegExp);

      return ![...tracked.files].some((file) => patterns.some((pattern) => pattern.test(file)));
    })
    .map((glob) => ({ severity: FAIL, message: `path glob matches no tracked file: ${glob}` }));

  return { findings, detail: `${globs.length} path globs` };
}

function collectRuleFiles() {
  if (!existsSync(RULES_DIR)) {
    return [];
  }

  return readdirSync(RULES_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => join(RULES_DIR, name));
}

/**
 * Maps whatever the caller named — a skill directory, a file inside one, a rule — onto the units
 * this script validates. lint-staged hands over staged file paths, so a change to one reference
 * document must still validate the whole skill it belongs to.
 */
function resolveTargets(targets) {
  if (targets.length === 0) {
    return { skills: collectSkillDirectories(), rules: collectRuleFiles() };
  }

  const skills = new Set();
  const rules = new Set();

  for (const target of targets) {
    const absolute = resolve(REPO_ROOT, target);

    if (!existsSync(absolute)) {
      throw new Error(`No such file or directory: ${target}`);
    }

    if (absolute === RULES_DIR) {
      collectRuleFiles().forEach((rule) => rules.add(rule));
    } else if (absolute.startsWith(RULES_DIR + sep)) {
      rules.add(absolute);
    } else if (absolute === SKILLS_DIR) {
      collectSkillDirectories().forEach((directory) => skills.add(directory));
    } else if (absolute.startsWith(SKILLS_DIR + sep)) {
      skills.add(join(SKILLS_DIR, relative(SKILLS_DIR, absolute).split(sep)[0]));
    } else {
      // A path outside `.claude/` was staged alongside one inside it. Saying so beats silently
      // reporting a pass over a file this script never read.
      throw new Error(`Not a skill or a rule: ${target}`);
    }
  }

  return { skills: [...skills].sort(), rules: [...rules].sort() };
}

function reportUnit(displayPath, result, strict) {
  let failed = false;

  for (const finding of result.findings) {
    const fails = strict || finding.severity === FAIL;

    failed ||= fails;
    console.error(`${fails ? 'FAIL' : 'warn'}  ${displayPath}  ${finding.message}`);
  }

  if (!failed) {
    console.log(`ok    ${displayPath}  ${result.detail ?? ''}`.trimEnd());
  }

  return failed ? 1 : 0;
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const { skills, rules } = resolveTargets(args.filter((arg) => !arg.startsWith('--')));

  if (skills.length === 0 && rules.length === 0) {
    console.log('No skills or rules found.');
    return 0;
  }

  const context = {
    packages: collectWorkspacePackages(),
    rootScripts: getRootScripts(),
    tracked: collectTrackedPaths(),
  };
  const declaredNames = new Map();
  let failed = 0;

  for (const skillDirectory of skills) {
    const result = validateSkill(skillDirectory, context);
    const displayPath = relative(REPO_ROOT, skillDirectory);

    // Two skills answering to one name is unresolvable from inside a session: the harness picks one
    // and the other is simply never reachable.
    if (result.declaredName !== undefined) {
      const claimedBy = declaredNames.get(result.declaredName);

      if (claimedBy !== undefined) {
        result.findings.push({
          severity: FAIL,
          message: `name "${result.declaredName}" is also declared by ${claimedBy}`,
        });
      }

      declaredNames.set(result.declaredName, displayPath);
    }

    failed += reportUnit(displayPath, result, strict);
  }

  for (const rulePath of rules) {
    failed += reportUnit(
      relative(REPO_ROOT, rulePath),
      validateRule(rulePath, context.tracked),
      strict,
    );
  }

  const total = skills.length + rules.length;

  console.log(`\n${total - failed}/${total} valid.`);

  return failed === 0 ? 0 : 1;
}

module.exports = {
  DESCRIPTION_HARD_LIMIT,
  REQUIRED_SKILL_KEYS,
  SKILL_LINE_BUDGET,
  collectCodeSpans,
  collectSkillDirectories,
  expandBraces,
  globToRegExp,
  main,
  parseFrontmatter,
  resolveTargets,
  validateRule,
  validateSkill,
};

// Requiring this module stays side-effect-free, the way `validate-workflows.cjs` does, so a spec
// can read the helpers above without running a validation pass.
if (require.main === module) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
