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
 * Usage:
 *   pnpm workflow:validate                       # every scope directory below
 *   pnpm workflow:validate workflows/users       # one directory
 *   pnpm workflow:validate path/to/one.json      # one file
 */

const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join, relative, resolve } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');

/** What a bare invocation checks. Mirrors the scopes the engine's file loader discovers. */
const DEFAULT_TARGETS = ['workflows/built-in', 'workflows/fixtures', 'workflows/users'];

const VALIDATOR_MODULE = join(REPO_ROOT, 'packages/shared/ddl-schema/dist/index.js');

function loadValidator() {
  try {
    return require(VALIDATOR_MODULE).validateAndNormalizeWorkflow;
  } catch {
    throw new Error(
      `@tsh/ddl-schema is not built at ${relative(REPO_ROOT, VALIDATOR_MODULE)}.\n` +
        'Build it first: pnpm --filter @tsh/ddl-schema build',
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
    .sort()
    .map((name) => join(absolute, name));
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
    const revision = `${normalized.id}@${normalized.version}`;

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
  const files = (explicit ? targets : DEFAULT_TARGETS).flatMap((target) =>
    collectFiles(target, explicit),
  );

  if (files.length === 0) {
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

try {
  process.exit(main());
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
