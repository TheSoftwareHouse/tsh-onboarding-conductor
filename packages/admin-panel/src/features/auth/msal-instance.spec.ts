import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedPublicClientApplication, mockedReadAuthConfig } = vi.hoisted(() => ({
  mockedPublicClientApplication: vi.fn(),
  mockedReadAuthConfig: vi.fn(),
}));

vi.mock('@azure/msal-browser', () => ({
  PublicClientApplication: mockedPublicClientApplication,
}));

vi.mock('./config/auth-config', () => ({
  readAuthConfig: mockedReadAuthConfig,
}));

const BASE_CONFIG = {
  clientId: 'client-id',
  tenantId: 'tenant-id',
  apiScope: 'api://engine-id/Onboardings.Read',
  redirectUri: undefined as string | undefined,
};

async function loadModule() {
  const module = await import('./msal-instance');
  module.resetMsalInstance();

  return module;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockedReadAuthConfig.mockReturnValue({ ...BASE_CONFIG });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getMsalInstance', () => {
  it('reads no Entra configuration until it is actually asked for a client', async () => {
    // A build with sign-in disabled never calls this, and must not need a tenant to start.
    await import('./msal-instance');

    expect(mockedReadAuthConfig).not.toHaveBeenCalled();
  });

  it('builds one client and reuses it, so tokens are not split across caches', async () => {
    const { getMsalInstance } = await loadModule();

    const first = getMsalInstance();
    const second = getMsalInstance();

    expect(first).toBe(second);
    expect(mockedPublicClientApplication).toHaveBeenCalledTimes(1);
  });

  it('points the client at the configured directory alone, not a multi-tenant authority', async () => {
    const { getMsalInstance } = await loadModule();

    getMsalInstance();

    expect(mockedPublicClientApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          clientId: 'client-id',
          authority: 'https://login.microsoftonline.com/tenant-id',
        }),
      }),
    );
  });

  it('keeps tokens in sessionStorage so they die with the tab', async () => {
    const { getMsalInstance } = await loadModule();

    getMsalInstance();

    expect(mockedPublicClientApplication).toHaveBeenCalledWith(
      expect.objectContaining({ cache: { cacheLocation: 'sessionStorage' } }),
    );
  });

  it('defaults the redirect URI to the origin the panel is served from', async () => {
    const { getMsalInstance } = await loadModule();

    getMsalInstance();

    expect(mockedPublicClientApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({ redirectUri: window.location.origin }),
      }),
    );
  });

  it('honours a configured redirect URI over the serving origin', async () => {
    mockedReadAuthConfig.mockReturnValue({
      ...BASE_CONFIG,
      redirectUri: 'https://admin.example.com/callback',
    });
    const { getMsalInstance } = await loadModule();

    getMsalInstance();

    expect(mockedPublicClientApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({ redirectUri: 'https://admin.example.com/callback' }),
      }),
    );
  });

  it('builds a fresh client after a reset, which is what lets a spec swap configuration', async () => {
    const { getMsalInstance, resetMsalInstance } = await loadModule();

    getMsalInstance();
    resetMsalInstance();
    getMsalInstance();

    expect(mockedPublicClientApplication).toHaveBeenCalledTimes(2);
  });

  it('surfaces a configuration error rather than building a half-configured client', async () => {
    mockedReadAuthConfig.mockImplementation(() => {
      throw new Error('VITE_AZURE_CLIENT_ID is required while sign-in is enabled.');
    });
    const { getMsalInstance } = await loadModule();

    expect(() => getMsalInstance()).toThrow('VITE_AZURE_CLIENT_ID');
    expect(mockedPublicClientApplication).not.toHaveBeenCalled();
  });
});
