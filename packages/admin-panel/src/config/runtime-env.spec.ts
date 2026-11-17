import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRuntimeEnv } from './runtime-env';

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.__ENV__;
});

describe('readRuntimeEnv', () => {
  it('falls back to import.meta.env when window.__ENV__ is absent, as under pnpm dev and Vitest', () => {
    vi.stubEnv('VITE_ENGINE_API_BASE_URL', 'http://localhost:3000');

    expect(readRuntimeEnv().VITE_ENGINE_API_BASE_URL).toBe('http://localhost:3000');
  });

  it('prefers a value written to window.__ENV__ over the build-time one', () => {
    vi.stubEnv('VITE_ENGINE_API_BASE_URL', 'http://localhost:3000');
    window.__ENV__ = { VITE_ENGINE_API_BASE_URL: 'http://engine:3000' };

    expect(readRuntimeEnv().VITE_ENGINE_API_BASE_URL).toBe('http://engine:3000');
  });

  it('falls through to the build-time value when window.__ENV__ carries an empty string, rather than shadowing it', () => {
    vi.stubEnv('VITE_AUTH_MICROSOFT_ENABLED', 'true');
    window.__ENV__ = { VITE_AUTH_MICROSOFT_ENABLED: '' };

    expect(readRuntimeEnv().VITE_AUTH_MICROSOFT_ENABLED).toBe('true');
  });
});
