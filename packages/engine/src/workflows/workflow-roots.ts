import { join, resolve } from 'node:path';

// `nest build` mirrors `src/` into `dist/`, so this file keeps the same depth
// relative to the engine package root whether it runs from sources or from the
// build output.
const ENGINE_PACKAGE_ROOT = resolve(__dirname, '..', '..');

/**
 * Repository-root `workflows/` directory. Built-in and fixture workflows ship
 * with the application and are deliberately not configurable; only the user
 * scope can be pointed elsewhere (see `WORKFLOWS_USERS_DIR`).
 */
export const WORKFLOWS_ROOT = resolve(ENGINE_PACKAGE_ROOT, '..', '..', 'workflows');

export const BUILT_IN_WORKFLOWS_DIR = join(WORKFLOWS_ROOT, 'built-in');

export const FIXTURE_WORKFLOWS_DIR = join(WORKFLOWS_ROOT, 'fixtures');

export const DEFAULT_USER_WORKFLOWS_DIR = join(WORKFLOWS_ROOT, 'users');
