/**
 * Every deployment names the environment it is — `dev`, `staging`, `pre-prod`, `prod` or any other
 * slug an operator chooses — and runs under one `NODE_ENV`. The name is a label for people;
 * `NODE_ENV` is what the engine acts on: `production` turns on every production-only rule (fixture
 * workflows and adapters skipped, HTTPS client webhooks, signed connector callbacks, admin
 * authentication required), and `test` marks a test run, the only one `CONNECTOR_MOCKS` applies to.
 * The name never changes behaviour.
 */
export enum NodeEnv {
  DEVELOPMENT = 'development',
  PRODUCTION = 'production',
  TEST = 'test',
}

/** A lowercase slug, so the name reads the same in a log line, an audit row and the panel. */
export const ENVIRONMENT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Trims and validates `ENVIRONMENT_NAME`; there is no default, so a deployment must name itself. */
export function parseEnvironmentName(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? '';

  if (!ENVIRONMENT_NAME_PATTERN.test(trimmed)) {
    throw new Error(
      `ENVIRONMENT_NAME is required and must be a lowercase slug matching ${ENVIRONMENT_NAME_PATTERN.source}, for example dev, staging, pre-prod or prod`,
    );
  }

  return trimmed;
}
