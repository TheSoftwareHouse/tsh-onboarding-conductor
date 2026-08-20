import { join, resolve } from 'node:path';

// `nest build` mirrors `src/` into `dist/`, so this file keeps the same depth
// relative to the engine package root whether it runs from sources or from the
// build output.
const ENGINE_PACKAGE_ROOT = resolve(__dirname, '..', '..');

/**
 * Repository-root `email-templates/` directory. Built-in and fixture templates
 * ship with the application and are deliberately not configurable; only the
 * user scope can be pointed elsewhere (see `EMAIL_TEMPLATES_USERS_DIR`).
 */
export const EMAIL_TEMPLATES_ROOT = resolve(ENGINE_PACKAGE_ROOT, '..', '..', 'email-templates');

export const BUILT_IN_EMAIL_TEMPLATES_DIR = join(EMAIL_TEMPLATES_ROOT, 'built-in');

export const FIXTURE_EMAIL_TEMPLATES_DIR = join(EMAIL_TEMPLATES_ROOT, 'fixtures');

export const DEFAULT_USER_EMAIL_TEMPLATES_DIR = join(EMAIL_TEMPLATES_ROOT, 'users');
