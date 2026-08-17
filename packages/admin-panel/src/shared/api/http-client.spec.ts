import { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedCreate, mockedUse, mockedAcquireEngineAccessToken } = vi.hoisted(() => {
  const mockedUse = vi.fn();
  const mockedCreate = vi.fn(() => ({
    get: vi.fn(),
    interceptors: { request: { use: mockedUse } },
  }));

  return {
    mockedCreate,
    mockedUse,
    mockedAcquireEngineAccessToken: vi.fn<() => Promise<string | null>>(),
  };
});

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();

  return {
    ...actual,
    default: {
      ...actual.default,
      create: mockedCreate,
    },
  };
});

vi.mock('@/features/auth', () => ({
  acquireEngineAccessToken: mockedAcquireEngineAccessToken,
}));

async function loadRequestInterceptor(): Promise<
  (config: InternalAxiosRequestConfig) => Promise<InternalAxiosRequestConfig>
> {
  await import('./http-client');

  expect(mockedUse).toHaveBeenCalledTimes(1);

  return mockedUse.mock.calls[0][0] as (
    config: InternalAxiosRequestConfig,
  ) => Promise<InternalAxiosRequestConfig>;
}

function createConfig(): InternalAxiosRequestConfig {
  return { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
}

beforeEach(() => {
  vi.resetModules();
  mockedCreate.mockClear();
  mockedUse.mockClear();
  mockedAcquireEngineAccessToken.mockReset();
  mockedAcquireEngineAccessToken.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('httpClient', () => {
  it('creates a single Axios instance configured with the engine base URL and no credentials', async () => {
    vi.stubEnv('VITE_ENGINE_API_BASE_URL', 'http://engine.internal');

    await import('./http-client');

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(mockedCreate).toHaveBeenCalledWith({
      baseURL: 'http://engine.internal',
      withCredentials: false,
    });
  });

  it('creates the instance with an undefined base URL when VITE_ENGINE_API_BASE_URL is not configured', async () => {
    vi.stubEnv('VITE_ENGINE_API_BASE_URL', undefined);

    await import('./http-client');

    expect(mockedCreate).toHaveBeenCalledWith({
      baseURL: undefined,
      withCredentials: false,
    });
  });

  it('attaches the acquired access token as a bearer credential', async () => {
    mockedAcquireEngineAccessToken.mockResolvedValue('access-token-value');

    const interceptor = await loadRequestInterceptor();
    const config = await interceptor(createConfig());

    expect(config.headers.get('Authorization')).toBe('Bearer access-token-value');
  });

  it('sends no Authorization header when no access token is available', async () => {
    mockedAcquireEngineAccessToken.mockResolvedValue(null);

    const interceptor = await loadRequestInterceptor();
    const config = await interceptor(createConfig());

    expect(config.headers.get('Authorization')).toBeUndefined();
  });

  it('fails the request rather than sending it unauthenticated when acquisition throws', async () => {
    // Falling through here would reach the engine with no credential, come back 401, and tell the
    // operator to sign in again over what was really a token-acquisition fault.
    mockedAcquireEngineAccessToken.mockRejectedValue(new Error('network unreachable'));

    const interceptor = await loadRequestInterceptor();

    await expect(interceptor(createConfig())).rejects.toThrow('network unreachable');
  });

  it('acquires a token for every request rather than reusing one across the session', async () => {
    // MSAL owns expiry and renewal; caching a bearer here would outlive its own token.
    mockedAcquireEngineAccessToken.mockResolvedValue('access-token-value');

    const interceptor = await loadRequestInterceptor();
    await interceptor(createConfig());
    await interceptor(createConfig());

    expect(mockedAcquireEngineAccessToken).toHaveBeenCalledTimes(2);
  });
});
