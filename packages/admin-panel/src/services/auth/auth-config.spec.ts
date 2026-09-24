import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAuthEnabled, readAuthConfig, readSsoProvider } from './auth-config';

function stubAzureEnv(): void {
  vi.stubEnv('VITE_AZURE_CLIENT_ID', 'client-id');
  vi.stubEnv('VITE_AZURE_TENANT_ID', 'tenant-id');
  vi.stubEnv('VITE_AZURE_API_SCOPE', 'api://engine-id/Onboardings.Read');
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.__ENV__;
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

  it('a runtime VITE_AUTH_ENABLED overrides a conflicting build-time value', () => {
    vi.stubEnv('VITE_AUTH_ENABLED', 'true');
    window.__ENV__ = { VITE_AUTH_ENABLED: 'false' };

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

  it('refuses an unsupported runtime provider by name too, even when the build-time value is supported', () => {
    vi.stubEnv('VITE_SSO_PROVIDER', 'azure');
    window.__ENV__ = { VITE_SSO_PROVIDER: 'google' };

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

  it('prefers runtime values over build-time ones for every field', () => {
    stubAzureEnv();
    vi.stubEnv('VITE_AZURE_REDIRECT_URI', 'http://localhost:5173/');
    window.__ENV__ = {
      VITE_AZURE_CLIENT_ID: 'runtime-client-id',
      VITE_AZURE_TENANT_ID: 'runtime-tenant-id',
      VITE_AZURE_API_SCOPE: 'api://runtime-engine-id/Onboardings.Read',
      VITE_AZURE_REDIRECT_URI: 'http://runtime-host:5173/',
    };

    expect(readAuthConfig()).toEqual({
      provider: 'azure',
      clientId: 'runtime-client-id',
      tenantId: 'runtime-tenant-id',
      apiScope: 'api://runtime-engine-id/Onboardings.Read',
      redirectUri: 'http://runtime-host:5173/',
    });
  });

  it('falls through an empty-string runtime value to the build-time one, so the error names the variable that is genuinely missing rather than the shadowed one', () => {
    stubAzureEnv();
    window.__ENV__ = { VITE_AZURE_CLIENT_ID: '' };
    vi.stubEnv('VITE_AZURE_TENANT_ID', undefined);

    // If the empty runtime value incorrectly shadowed the build-time client ID, this would
    // throw naming VITE_AZURE_CLIENT_ID instead, since it is read before the tenant ID.
    expect(() => readAuthConfig()).toThrow('VITE_AZURE_TENANT_ID');
  });
});
