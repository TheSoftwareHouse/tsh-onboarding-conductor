import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAuthEnabled, readAuthConfig, readSsoProvider } from './auth-config';

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

describe('readSsoProvider', () => {
  it('defaults to Entra so an existing build keeps signing in where it always did', () => {
    vi.stubEnv('VITE_SSO_PROVIDER', undefined);

    expect(readSsoProvider()).toBe('azure');
  });

  it('accepts a supported provider regardless of casing or padding', () => {
    vi.stubEnv('VITE_SSO_PROVIDER', ' Azure ');

    expect(readSsoProvider()).toBe('azure');
  });

  it('refuses an unsupported provider by name rather than falling back to Entra', () => {
    // Falling back would sign operators in against a directory nobody asked for, and the panel
    // would look correctly configured while doing it.
    vi.stubEnv('VITE_SSO_PROVIDER', 'google');

    expect(() => readSsoProvider()).toThrow(/VITE_SSO_PROVIDER='google' is not a supported/);
  });
});

describe('readAuthConfig', () => {
  it('refuses to read a configuration for an unsupported provider', () => {
    stubAzureEnv();
    vi.stubEnv('VITE_SSO_PROVIDER', 'google');

    expect(() => readAuthConfig()).toThrow('VITE_SSO_PROVIDER');
  });

  it('reads the Entra configuration', () => {
    stubAzureEnv();
    vi.stubEnv('VITE_AZURE_REDIRECT_URI', 'http://localhost:5173/');

    expect(readAuthConfig()).toEqual({
      provider: 'azure',
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
