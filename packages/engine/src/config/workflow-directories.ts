import { resolve } from 'node:path';

/**
 * `workflows/` is a sibling of both `src/` and the compiled `dist/`, so these resolve to the same
 * place whether the engine runs from TypeScript sources or from the build output — and without
 * depending on the working directory.
 *
 * These are deliberately not configurable. Built-in and fixture workflows ship inside the engine
 * package, so their location is a property of the build, not of a deployment. Only the operator's
 * own directory (`WORKFLOWS_DIR`) is a setting.
 */
const ENGINE_PACKAGE_ROOT = resolve(__dirname, '..', '..');

export const BUILT_IN_WORKFLOWS_DIR = resolve(ENGINE_PACKAGE_ROOT, 'workflows', 'built-in');

export const FIXTURE_WORKFLOWS_DIR = resolve(ENGINE_PACKAGE_ROOT, 'workflows', 'fixtures');
