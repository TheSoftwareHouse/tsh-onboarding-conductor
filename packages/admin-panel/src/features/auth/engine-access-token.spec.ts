import { InteractionRequiredAuthError } from '@azure/msal-browser';
import type { AccountInfo, PublicClientApplication } from '@azure/msal-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireEngineAccessToken } from './engine-access-token';

const { mockedIsAuthEnabled, mockedReadAuthConfig, mockedGetMsalInstance } = vi.hoisted(() => ({
  mockedIsAuthEnabled: vi.fn<() => boolean>(),
  mockedReadAuthConfig: vi.fn(),
  mockedGetMsalInstance: vi.fn(),
}));

vi.mock('./config/auth-config', () => ({
  isAuthEnabled: mockedIsAuthEnabled,
  readAuthConfig: mockedReadAuthConfig,
}));

vi.mock('./msal-instance', () => ({
  getMsalInstance: mockedGetMsalInstance,
}));

const API_SCOPE = 'api://engine-id/Onboardings.Read';

function account(username: string): AccountInfo {
  return {
    homeAccountId: `home-${username}`,
    environment: 'login.microsoftonline.com',
    tenantId: 'tenant-id',
    username,
    localAccountId: `local-${username}`,
  } as AccountInfo;
}

type InstanceStub = {
  getActiveAccount: ReturnType<typeof vi.fn>;
  getAllAccounts: ReturnType<typeof vi.fn>;
  acquireTokenSilent: ReturnType<typeof vi.fn>;
  acquireTokenRedirect: ReturnType<typeof vi.fn>;
};

function stubInstance(overrides: Partial<InstanceStub> = {}): InstanceStub {
  const instance: InstanceStub = {
    getActiveAccount: vi.fn(() => null),
    getAllAccounts: vi.fn(() => []),
    acquireTokenSilent: vi.fn(() => Promise.resolve({ accessToken: 'access-token-value' })),
    acquireTokenRedirect: vi.fn(() => Promise.resolve()),
    ...overrides,
  };

  mockedGetMsalInstance.mockReturnValue(instance as unknown as PublicClientApplication);

  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedIsAuthEnabled.mockReturnValue(true);
  mockedReadAuthConfig.mockReturnValue({
    clientId: 'client-id',
    tenantId: 'tenant-id',
    apiScope: API_SCOPE,
  });
});

describe('acquireEngineAccessToken', () => {
  it('returns no token when sign-in is switched off, without touching MSAL', async () => {
    mockedIsAuthEnabled.mockReturnValue(false);

    await expect(acquireEngineAccessToken()).resolves.toBeNull();
    expect(mockedGetMsalInstance).not.toHaveBeenCalled();
    expect(mockedReadAuthConfig).not.toHaveBeenCalled();
  });

  it('returns no token when nobody is signed in yet', async () => {
    const instance = stubInstance();

    await expect(acquireEngineAccessToken()).resolves.toBeNull();
    expect(instance.acquireTokenSilent).not.toHaveBeenCalled();
  });

  it('returns the access token MSAL serves from its cache', async () => {
    stubInstance({ getActiveAccount: vi.fn(() => account('anna@tsh.io')) });

    await expect(acquireEngineAccessToken()).resolves.toBe('access-token-value');
  });

  it('asks for the configured engine scope on behalf of the signed-in account', async () => {
    const activeAccount = account('anna@tsh.io');
    const instance = stubInstance({ getActiveAccount: vi.fn(() => activeAccount) });

    await acquireEngineAccessToken();

    expect(instance.acquireTokenSilent).toHaveBeenCalledWith({
      account: activeAccount,
      scopes: [API_SCOPE],
    });
  });

  it('falls back to the first known account when none has been made active', async () => {
    const first = account('first@tsh.io');
    const instance = stubInstance({
      getActiveAccount: vi.fn(() => null),
      getAllAccounts: vi.fn(() => [first, account('second@tsh.io')]),
    });

    await acquireEngineAccessToken();

    expect(instance.acquireTokenSilent).toHaveBeenCalledWith({
      account: first,
      scopes: [API_SCOPE],
    });
  });

  it('prefers the active account over the rest of the cache', async () => {
    const activeAccount = account('active@tsh.io');
    const instance = stubInstance({
      getActiveAccount: vi.fn(() => activeAccount),
      getAllAccounts: vi.fn(() => [account('other@tsh.io')]),
    });

    await acquireEngineAccessToken();

    expect(instance.acquireTokenSilent).toHaveBeenCalledWith(
      expect.objectContaining({ account: activeAccount }),
    );
  });

  describe('when Entra requires the user to interact again', () => {
    it('starts a redirect and reports no token, so the caller fails rather than hangs', async () => {
      const activeAccount = account('anna@tsh.io');
      const instance = stubInstance({
        getActiveAccount: vi.fn(() => activeAccount),
        acquireTokenSilent: vi.fn(() =>
          Promise.reject(
            new InteractionRequiredAuthError('interaction_required', 'consent required'),
          ),
        ),
      });

      await expect(acquireEngineAccessToken()).resolves.toBeNull();
      expect(instance.acquireTokenRedirect).toHaveBeenCalledWith({
        account: activeAccount,
        scopes: [API_SCOPE],
      });
    });
  });

  it('rethrows any other failure rather than silently sending an unauthenticated request', async () => {
    // Swallowing this would drop the request to the engine with no Authorization header, which
    // comes back as a 401 and sends the operator chasing their session over an unrelated fault.
    const instance = stubInstance({
      getActiveAccount: vi.fn(() => account('anna@tsh.io')),
      acquireTokenSilent: vi.fn(() => Promise.reject(new Error('network unreachable'))),
    });

    await expect(acquireEngineAccessToken()).rejects.toThrow('network unreachable');
    expect(instance.acquireTokenRedirect).not.toHaveBeenCalled();
  });
});
