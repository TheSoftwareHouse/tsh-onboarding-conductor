import { resolve } from 'node:path';

/**
 * Where a workflow definition came from.
 *
 * This lives under `config/` rather than `workflows/` so that connectors can depend on it without
 * creating a `connectors` <-> `workflows` import cycle.
 */
export const WorkflowSourceKind = {
  BUILT_IN: 'built-in',
  FIXTURES: 'fixtures',
  USER: 'user',
} as const;

export type WorkflowSourceKind = (typeof WorkflowSourceKind)[keyof typeof WorkflowSourceKind];

/**
 * `workflows/` and `email-templates/` are siblings of both `src/` and the compiled `dist/`, so
 * these resolve to the same place whether the engine runs from TypeScript sources or from the
 * build output — and without depending on the working directory.
 *
 * The built-in and fixture paths are deliberately not configurable: they ship inside the engine
 * package, so their location is a property of the build, not of a deployment. Only the operator's
 * own directories (`WORKFLOWS_DIR`, `EMAIL_TEMPLATES_DIR`) are settings.
 */
const ENGINE_PACKAGE_ROOT = resolve(__dirname, '..', '..');

export const BUILT_IN_WORKFLOWS_DIR = resolve(ENGINE_PACKAGE_ROOT, 'workflows', 'built-in');

export const FIXTURE_WORKFLOWS_DIR = resolve(ENGINE_PACKAGE_ROOT, 'workflows', 'fixtures');

export const BUILT_IN_EMAIL_TEMPLATES_DIR = resolve(
  ENGINE_PACKAGE_ROOT,
  'email-templates',
  'built-in',
);

export const FIXTURE_EMAIL_TEMPLATES_DIR = resolve(
  ENGINE_PACKAGE_ROOT,
  'email-templates',
  'fixtures',
);
