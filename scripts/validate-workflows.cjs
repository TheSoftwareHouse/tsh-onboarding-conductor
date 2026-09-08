#!/usr/bin/env node

/**
 * Validates workflow definition files against the DDL schema without starting the engine.
 *
 * This runs the same `validateAndNormalizeWorkflow` the engine runs at startup, so a file that
 * passes here will not fail bootstrap for a schema reason. It does not run the engine's own
 * checks — that a connector `id` names a registered adapter, that its `type` agrees with that
 * adapter, and whatever the adapter's `validateDeclaration` hook asserts — which still need a
 * running engine.
 *
 * The discovery and duplicate-revision rules below mirror
 * `packages/engine/src/workflows/workflow-file-loader.service.ts`, and
 * `validate-workflows-script-parity.spec.ts` beside it fails when they drift apart.
 *
 * Usage:
 *   pnpm workflow:validate                       # every scope directory below
 *   pnpm workflow:validate workflows/users       # one directory
 *   pnpm workflow:validate path/to/one.json      # one file
 */

const { existsSync, readdirSync, readFileSync, statSync } = require('node:fs');
const { join, relative, resolve } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');

const VALIDATOR_SOURCE_DIR = join(REPO_ROOT, 'packages/shared/ddl-schema/src');
const VALIDATOR_MODULE = join(REPO_ROOT, 'packages/shared/ddl-schema/dist/index.js');
const ENV_FILE = join(REPO_ROOT, '.env');

/** The scopes that ship with the application. `workflow-roots.ts` fixes them the same way. */
const SHIPPED_TARGETS = ['workflows/built-in', 'workflows/fixtures'];

/** What the engine falls back to when `WORKFLOWS_USERS_DIR` is unset. */
const DEFAULT_USER_TARGET = 'workflows/users';

/**
 * Reads one variable the way the engine's configuration does: `.env` only, never `.env.dist`.
 * A value already in the environment wins, so a one-off override on the command line works.
 */
function readEnvValue(key) {
  const fromProcess = process.env[key];

  if (typeof fromProcess === 'string' && fromProcess.trim().length > 0) {
    return fromProcess.trim();
  }

  let contents;

  try {
    contents = readFileSync(ENV_FILE, 'utf8');
  } catch {
    return undefined;
  }

  for (const line of contents.split('\n')) {
    const assignment = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);

    if (assignment === null || assignment[1] !== key) {
      continue;
    }

    const value = assignment[2]
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
      .trim();

    if (value.length > 0) {
      return value;
    }
  }

  return undefined;
}

/**
 * What a bare invocation checks. Mirrors the scopes the engine's file loader discovers, honouring
 * `WORKFLOWS_USERS_DIR` as it does: under Compose that value is the host directory bind-mounted at
 * `/app/workflows/users`, and Compose resolves a relative one against the repository root, so the
 * same value read here names the same files the engine will load.
 */
function defaultTargets() {
  return [...SHIPPED_TARGETS, readEnvValue('WORKFLOWS_USERS_DIR') ?? DEFAULT_USER_TARGET];
}

function loadValidator() {
  if (!existsSync(VALIDATOR_MODULE)) {
    throw new Error(
      `@tsh/ddl-schema is not built at ${relative(REPO_ROOT, VALIDATOR_MODULE)}.\n` +
        'Build it first: pnpm --filter @tsh/ddl-schema build',
    );
  }

  // The build output is there, so anything thrown from here is a real load failure — a broken
  // build, a missing transitive dependency — and calling that "not built" would send the reader
  // to a command that cannot fix it.
  return require(VALIDATOR_MODULE).validateAndNormalizeWorkflow;
}

/** Newest mtime anywhere under a directory. */
function newestMtimeIn(directory) {
  let newest = 0;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    const mtime = entry.isDirectory() ? newestMtimeIn(entryPath) : statSync(entryPath).mtimeMs;

    newest = Math.max(newest, mtime);
  }

  return newest;
}

/**
 * Build output older than its sources validates against a schema the engine no longer runs, which
 * is exactly the parity this script exists to promise. A warning rather than a failure: mtimes are
 * not a dependency graph, and whether to rebuild is the reader's call.
 */
function warnWhenValidatorIsStale() {
  let builtAt;
  let newestSource;

  try {
    builtAt = statSync(VALIDATOR_MODULE).mtimeMs;
    newestSource = newestMtimeIn(VALIDATOR_SOURCE_DIR);
  } catch {
    return;
  }

  if (newestSource > builtAt) {
    console.error(
      'warning: @tsh/ddl-schema sources are newer than its build, so this run may not match what\n' +
        '         the engine validates. Rebuild it: pnpm --filter @tsh/ddl-schema build\n',
    );
  }
}

/** Only `.json` files directly inside a directory, which is all the engine's loader discovers. */
function collectFiles(target, explicit) {
  const absolute = resolve(REPO_ROOT, target);
  let stats;

  try {
    stats = statSync(absolute);
  } catch {
    if (explicit) {
      throw new Error(`No such file or directory: ${target}`);
    }
    return [];
  }

  if (stats.isFile()) {
    return [absolute];
  }

  return readdirSync(absolute)
    .filter((name) => name.endsWith('.json'))
    .filter((name) => statSync(join(absolute, name)).isFile())
    .sort()
    .map((name) => join(absolute, name));
}

/** The loader's duplicate-detection key, character for character. */
function revisionKeyOf(workflowId, version) {
  return `${workflowId}@${version}`;
}

function validateFile(filePath, validate) {
  let definition;

  try {
    definition = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { ok: false, detail: `unparseable JSON — ${error.message}` };
  }

  try {
    const normalized = validate(definition);
    const revision = revisionKeyOf(normalized.id, normalized.version);

    return {
      ok: true,
      revision,
      detail: `${revision}, ${normalized.steps.length} steps, initial=${normalized.initial}`,
    };
  } catch (error) {
    // The DDL reports a coarse reason and no path. The creating-workflows skill's
    // references/startup-failures.md maps each reason back to the checks that raise it.
    return { ok: false, detail: error.reason ?? error.message };
  }
}

/** Repository-relative where that reads better, absolute for anything outside it. */
function displayPathOf(filePath) {
  const relativePath = relative(REPO_ROOT, filePath);

  return relativePath.startsWith('..') ? filePath : relativePath;
}

function main() {
  const targets = process.argv.slice(2);
  const explicit = targets.length > 0;
  const validate = loadValidator();

  warnWhenValidatorIsStale();

  const files = (explicit ? targets : defaultTargets()).flatMap((target) =>
    collectFiles(target, explicit),
  );

  if (files.length === 0) {
    // A bare run has nothing to report. A run given paths validated nothing it was asked to, which
    // must not read as a pass in the check that precedes a restart.
    if (explicit) {
      console.error('No workflow files found in the paths given.');
      return 1;
    }

    console.log('No workflow files found.');
    return 0;
  }

  const revisions = new Map();
  let failed = 0;

  for (const filePath of files) {
    const displayPath = displayPathOf(filePath);
    const result = validateFile(filePath, validate);

    if (!result.ok) {
      failed += 1;
      console.error(`FAIL  ${displayPath}  ${result.detail}`);
      continue;
    }

    // Startup fails when two files declare the same id and version, whichever scopes they sit in.
    const claimedBy = revisions.get(result.revision);
    if (claimedBy !== undefined) {
      failed += 1;
      console.error(
        `FAIL  ${displayPath}  duplicate revision ${result.revision}, also ${claimedBy}`,
      );
      continue;
    }

    revisions.set(result.revision, displayPath);
    console.log(`ok    ${displayPath}  ${result.detail}`);
  }

  console.log(`\n${files.length - failed}/${files.length} valid.`);

  return failed === 0 ? 0 : 1;
}

module.exports = {
  DEFAULT_USER_TARGET,
  SHIPPED_TARGETS,
  collectFiles,
  defaultTargets,
  main,
  revisionKeyOf,
};

// Requiring this module must stay side-effect-free: the parity spec beside the engine's loader
// reads the helpers above without running a validation pass.
if (require.main === module) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
