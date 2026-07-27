import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedCreate } = vi.hoisted(() => {
  const mockedCreate = vi.fn(() => ({ get: vi.fn() }));
  return { mockedCreate };
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

beforeEach(() => {
  vi.resetModules();
  mockedCreate.mockClear();
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
});
