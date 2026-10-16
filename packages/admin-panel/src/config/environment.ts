import { readRuntimeEnv } from './runtime-env';

const PRODUCTION_NODE_ENV = 'production';

export interface Environment {
  /** The deployment's own label — `dev`, `staging`, `pre-prod`, `prod` or any slug it chose. */
  name: string;
  /** Whether the engine runs with `NODE_ENV=production`, which is what its production rules follow. */
  isProduction: boolean;
}

/**
 * The environment the engine serving this panel runs in, from the `/config.js` it rendered.
 * `undefined` under `pnpm dev` and in Vitest, where no engine wrote one.
 */
export function findEnvironment(): Environment | undefined {
  const { VITE_ENVIRONMENT_NAME: name, VITE_NODE_ENV: nodeEnv } = readRuntimeEnv();

  if (name === undefined) {
    return undefined;
  }

  return { name, isProduction: nodeEnv === PRODUCTION_NODE_ENV };
}
