import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('authClient', () => {
  it('is built against the engine base URL plus /v1/auth', async () => {
    vi.stubEnv('VITE_ENGINE_API_BASE_URL', 'http://engine.internal:3000/');
    const { createAuthClient } = await import('better-auth/react');
    const spy = vi.fn(createAuthClient);
    vi.doMock('better-auth/react', () => ({ createAuthClient: spy }));

    await import('./auth-client');

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'http://engine.internal:3000/v1/auth',
        fetchOptions: { credentials: 'include' },
      }),
    );
  });

  it('resolves the engine-rendered same-origin base URL "/" against the page origin', async () => {
    vi.stubEnv('VITE_ENGINE_API_BASE_URL', '/');
    const { createAuthClient } = await import('better-auth/react');
    const spy = vi.fn(createAuthClient);
    vi.doMock('better-auth/react', () => ({ createAuthClient: spy }));

    await import('./auth-client');

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: `${window.location.origin}/v1/auth` }),
    );
  });

  it('falls back to the page origin when no engine base URL is configured', async () => {
    vi.stubEnv('VITE_ENGINE_API_BASE_URL', undefined);
    const { createAuthClient } = await import('better-auth/react');
    const spy = vi.fn(createAuthClient);
    vi.doMock('better-auth/react', () => ({ createAuthClient: spy }));

    await import('./auth-client');

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: `${window.location.origin}/v1/auth` }),
    );
  });
});
