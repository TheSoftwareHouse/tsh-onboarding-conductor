#!/usr/bin/env node

/**
 * Validates the agent context checked into `.claude/` — the skills under `.claude/skills/` and the
 * path-scoped rules under `.claude/rules/` — without invoking a model.
 *
 * A skill is prose, so nothing type-checks it and nothing fails when it goes stale. The decay is
 * always the same shape: the skill keeps citing a command that was renamed, a file that moved or a
 * reference document nobody reads any more, and the model follows it into a dead end. Every check
 * below is a fact about the repository that a reader could verify by hand and never does, or a
 * rule of the Agent Skills specification (agentskills.io) — the SKILL.md format every agent
 * harness shares — so a skill that passes here is one the spec's `skills-ref validate` accepts.
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
 * Frontmatter keys, in three tiers, after the Agent Skills specification that Claude Code, Cursor,
 * Codex, Gemini CLI and the other SKILL.md consumers share. The spec's own keys pass. Claude Code's
 * documented extensions pass with a warning, because every other consumer ignores them — trigger
 * phrases kept in `when_to_use` are invisible to any agent but Claude Code, which is why the skills
 * here carry them in `description`. Anything else fails, the way the spec's reference validator
 * fails it: a typo'd key is ignored silently by every harness, and that silence is the defect.
 */
const REQUIRED_SKILL_KEYS = ['name', 'description'];
const SPEC_SKILL_KEYS = [
  ...REQUIRED_SKILL_KEYS,
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
];
const CLAUDE_CODE_SKILL_KEYS = [
  'when_to_use',
  'argument-hint',
  'arguments',
  'disable-model-invocation',
  'user-invocable',
  'disallowed-tools',
  'model',
  'effort',
  'context',
  'agent',
  'background',
  'hooks',
  'paths',
  'shell',
];

/**
 * The spec's `name` grammar: lowercase letters, digits and single hyphens, none at either end, at
 * most 64 characters; and `compatibility`, when declared, is at most 500.
 */
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SKILL_NAME_LIMIT = 64;
const COMPATIBILITY_LIMIT = 500;

/**
 * A skill's `description` is loaded into every session that has the skill available, whether or
 * not it fires, so its length is a standing tax — and it is also the only thing an agent reads
 * before deciding whether to open the skill, so it has to carry the trigger phrases too. The spec
 * caps it at 1024 characters and its reference validator refuses more. The soft cap warns before
 * that: descriptions grow while their triggers are being tuned, and 900 is the point to trim
 * rather than the point to fail.
 */
const DESCRIPTION_SOFT_LIMIT = 900;
const DESCRIPTION_HARD_LIMIT = 1024;

/**
 * `CLAUDE.md` holds itself to 200 lines, and a skill body earns no more latitude than that — the
 * whole body loads the moment the skill fires. The spec's own ceiling is 500 lines, past which it
 * tells authors to move material into `references/`; that one fails.
 */
const SKILL_LINE_BUDGET = 200;
const SKILL_LINE_LIMIT = 500;

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
 * Reads the leading `---` block. Values are scalars, folded or literal block scalars (`>` / `|`,
 * which the spec's own examples use for a long `description`), a list of scalars, or a one-level
 * map of scalars (`metadata`) — all the skills and rules in this repository use, so a real YAML
 * parser would be a dependency bought for nothing. Anything deeper is reported as unparseable
 * rather than guessed at.
 */
function parseFrontmatter(contents) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contents);

  if (match === null) {
    return { ok: false, detail: 'no frontmatter block' };
  }

  const values = {};
  // The key whose value is still being read: a block scalar (`>` / `|`) collects the indented lines
  // that follow into one string, and a bare `key:` collects them into a list or a map.
  let openKey;
  let blockStyle;

  for (const line of match[1].split('\n')) {
    if (
      line.trim().length === 0 ||
      (blockStyle === undefined && line.trimStart().startsWith('#'))
    ) {
      continue;
    }

    const nested = /^\s+(\S.*)$/.exec(line);

    if (nested !== null) {
      if (openKey === undefined) {
        return { ok: false, detail: `indented line outside any key: ${line.trim().slice(0, 60)}` };
      }

      if (blockStyle !== undefined) {
        const current = values[openKey];
        const separator = blockStyle === '|' ? '\n' : ' ';

        values[openKey] = current.length === 0 ? nested[1] : `${current}${separator}${nested[1]}`;
        continue;
      }

      const listItem = /^-\s*(.*)$/.exec(nested[1]);
      const mapEntry = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(nested[1]);

      if (listItem !== null) {
        values[openKey] ??= [];

        if (!Array.isArray(values[openKey])) {
          return { ok: false, detail: `"${openKey}" mixes list items with map entries` };
        }

        values[openKey].push(unquote(listItem[1]));
        continue;
      }

      if (mapEntry !== null) {
        values[openKey] ??= {};

        if (Array.isArray(values[openKey])) {
          return { ok: false, detail: `"${openKey}" mixes map entries with list items` };
        }

        values[openKey][mapEntry[1]] = unquote(mapEntry[2]);
        continue;
      }

      return { ok: false, detail: `unparseable line: ${line.trim().slice(0, 60)}` };
    }

    const assignment = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);

    if (assignment === null) {
      return { ok: false, detail: `unparseable line: ${line.trim().slice(0, 60)}` };
    }

    const [, key, rawValue] = assignment;
    const block = /^([>|])-?$/.exec(rawValue.trim());

    if (block !== null) {
      openKey = key;
      blockStyle = block[1];
      values[key] = '';
      continue;
    }

    blockStyle = undefined;

    if (rawValue.trim().length === 0) {
      // A bare `key:` opens a block whose indented lines decide whether it is a list or a map; one
      // that nothing follows is YAML's null.
      openKey = key;
      values[key] = null;
      continue;
    }

    openKey = undefined;
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
 * from the repository root in one paragraph and `fixtures/base.workflow.json` from inside
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
    if (SPEC_SKILL_KEYS.includes(key)) {
      continue;
    }

    if (CLAUDE_CODE_SKILL_KEYS.includes(key)) {
      findings.push({
        severity: WARN,
        message:
          key === 'when_to_use'
            ? 'frontmatter key "when_to_use" is read by Claude Code only; every other agent ignores it, so its trigger phrases belong in "description"'
            : `frontmatter key "${key}" is a Claude Code extension outside the Agent Skills spec; other agents ignore it`,
      });
      continue;
    }

    findings.push({
      severity: FAIL,
      message: `frontmatter key "${key}" is not in the Agent Skills spec (${SPEC_SKILL_KEYS.join(', ')}), so every harness ignores it silently`,
    });
  }

  if (typeof values.name === 'string') {
    if (values.name !== skillName) {
      findings.push({
        severity: FAIL,
        message: `frontmatter name "${values.name}" does not match directory "${skillName}"`,
      });
    }

    if (values.name.length > SKILL_NAME_LIMIT || !SKILL_NAME_PATTERN.test(values.name)) {
      findings.push({
        severity: FAIL,
        message: `name "${values.name}" breaks the spec's grammar: 1-${SKILL_NAME_LIMIT} lowercase letters, digits and single hyphens, none at either end`,
      });
    }
  }

  if (
    values.compatibility !== undefined &&
    (typeof values.compatibility !== 'string' ||
      values.compatibility.length === 0 ||
      values.compatibility.length > COMPATIBILITY_LIMIT)
  ) {
    findings.push({
      severity: FAIL,
      message: `compatibility must be a string of 1-${COMPATIBILITY_LIMIT} characters`,
    });
  }

  if (
    values.metadata !== undefined &&
    (values.metadata === null ||
      typeof values.metadata !== 'object' ||
      Array.isArray(values.metadata) ||
      !Object.values(values.metadata).every((entry) => typeof entry === 'string'))
  ) {
    findings.push({
      severity: FAIL,
      message: 'metadata must be a map of string keys to string values',
    });
  }

  if (
    values['allowed-tools'] !== undefined &&
    typeof values['allowed-tools'] !== 'string' &&
    !(
      Array.isArray(values['allowed-tools']) &&
      values['allowed-tools'].every((entry) => typeof entry === 'string')
    )
  ) {
    findings.push({
      severity: FAIL,
      message:
        'allowed-tools must be a space-separated string (the spec) or a list of strings (Claude Code)',
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

  if (
    typeof values.description === 'string' &&
    values.description.length > DESCRIPTION_SOFT_LIMIT &&
    values.description.length <= DESCRIPTION_HARD_LIMIT
  ) {
    findings.push({
      severity: WARN,
      message: `description is ${values.description.length} characters, within ${DESCRIPTION_HARD_LIMIT - values.description.length} of the ${DESCRIPTION_HARD_LIMIT} the spec allows; trim it before it fails`,
    });
  }

  const bodyLines = contents.split('\n').length;

  if (bodyLines > SKILL_LINE_LIMIT) {
    findings.push({
      severity: FAIL,
      message: `SKILL.md is ${bodyLines} lines, over the ${SKILL_LINE_LIMIT} the spec allows before material moves to references/`,
    });
  } else if (bodyLines > SKILL_LINE_BUDGET) {
    findings.push({
      severity: WARN,
      message: `SKILL.md is ${bodyLines} lines, over the ${SKILL_LINE_BUDGET}-line budget`,
    });
  }

  // Citations pool across the skill and its references, and the ones SKILL.md itself makes are
  // tracked apart: a reference reached only through another reference is still reached, but the
  // spec keeps references one level deep, and a chain is where an agent stops following.
  const referenceFiles = collectReferenceFiles(skillDirectory);
  const citedReferences = new Set();
  const citedFromSkill = new Set();

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

        if (documentPath === skillFile) {
          citedFromSkill.add(join(skillDirectory, link[1]));
        }
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

          if (documentPath === skillFile) {
            citedFromSkill.add(referencePath);
          }

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
    } else if (!citedFromSkill.has(referenceFile)) {
      findings.push({
        severity: WARN,
        message: `${relative(skillDirectory, referenceFile)} is cited only from another reference; the spec keeps references one level deep from SKILL.md`,
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
  CLAUDE_CODE_SKILL_KEYS,
  COMPATIBILITY_LIMIT,
  DESCRIPTION_HARD_LIMIT,
  DESCRIPTION_SOFT_LIMIT,
  REQUIRED_SKILL_KEYS,
  SKILL_LINE_BUDGET,
  SKILL_LINE_LIMIT,
  SKILL_NAME_LIMIT,
  SKILL_NAME_PATTERN,
  SPEC_SKILL_KEYS,
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
