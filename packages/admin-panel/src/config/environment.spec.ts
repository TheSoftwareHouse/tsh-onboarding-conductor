import { afterEach, describe, expect, it } from 'vitest';
import { findEnvironment } from './environment';

afterEach(() => {
  delete window.__ENV__;
});

describe('findEnvironment', () => {
  it('reads the name and production flag the engine wrote into /config.js', () => {
    window.__ENV__ = { VITE_ENVIRONMENT_NAME: 'pre-prod', VITE_NODE_ENV: 'production' };

    expect(findEnvironment()).toEqual({ name: 'pre-prod', isProduction: true });
  });

  it('treats any other NODE_ENV as not production', () => {
    window.__ENV__ = { VITE_ENVIRONMENT_NAME: 'staging', VITE_NODE_ENV: 'development' };

    expect(findEnvironment()).toEqual({ name: 'staging', isProduction: false });
  });

  it('finds nothing when no engine wrote an environment, as under pnpm dev', () => {
    expect(findEnvironment()).toBeUndefined();
  });
});
