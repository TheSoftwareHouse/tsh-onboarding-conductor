import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAuthEnabled, readAuthConfig } from './auth-config';

function stubAzureEnv(): void {
  vi.stubEnv('VITE_AZURE_CLIENT_ID', 'client-id');
  vi.stubEnv('VITE_AZURE_TENANT_ID', 'tenant-id');
  vi.stubEnv('VITE_AZURE_API_SCOPE', 'api://engine-id/Onboardings.Read');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isAuthEnabled', () => {
  it('is enabled when the flag is not configured, so a build cannot forget to gate itself', () => {
    vi.stubEnv('VITE_AUTH_ENABLED', undefined);

    expect(isAuthEnabled()).toBe(true);
  });

  it('is enabled for any value other than false', () => {
    vi.stubEnv('VITE_AUTH_ENABLED', 'true');

    expect(isAuthEnabled()).toBe(true);
  });

  it('is disabled only for an explicit false, regardless of casing or padding', () => {
    vi.stubEnv('VITE_AUTH_ENABLED', ' False ');

    expect(isAuthEnabled()).toBe(false);
  });
});

describe('readAuthConfig', () => {
  it('reads the Entra configuration', () => {
    stubAzureEnv();
    vi.stubEnv('VITE_AZURE_REDIRECT_URI', 'http://localhost:5173/');

    expect(readAuthConfig()).toEqual({
      clientId: 'client-id',
      tenantId: 'tenant-id',
      apiScope: 'api://engine-id/Onboardings.Read',
      redirectUri: 'http://localhost:5173/',
    });
  });

  it('leaves the redirect URI undefined so MSAL defaults to the serving origin', () => {
    stubAzureEnv();
    vi.stubEnv('VITE_AZURE_REDIRECT_URI', undefined);

    expect(readAuthConfig().redirectUri).toBeUndefined();
  });

  it.each([['VITE_AZURE_CLIENT_ID'], ['VITE_AZURE_TENANT_ID'], ['VITE_AZURE_API_SCOPE']])(
    'names %s when it is missing',
    (missingKey) => {
      stubAzureEnv();
      vi.stubEnv(missingKey, undefined);

      expect(() => readAuthConfig()).toThrow(missingKey);
    },
  );

  it('treats a blank value as missing', () => {
    stubAzureEnv();
    vi.stubEnv('VITE_AZURE_TENANT_ID', '   ');

    expect(() => readAuthConfig()).toThrow('VITE_AZURE_TENANT_ID');
  });
});
