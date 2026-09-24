import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchEncryptionState, type EncryptionState } from './admin-encryption';
import { encryptionQueries } from './encryption-queries';

vi.mock('./admin-encryption', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./admin-encryption')>()),
  fetchEncryptionState: vi.fn(),
}));

const mockedFetchEncryptionState = vi.mocked(fetchEncryptionState);

const STATE: EncryptionState = {
  enabled: false,
  keyConfigured: true,
  keys: [],
  rotation: { interval: null, nextRotationAt: null },
  progress: { pending: 0, total: 0 },
  reencrypting: false,
};

beforeEach(() => {
  mockedFetchEncryptionState.mockReset();
  mockedFetchEncryptionState.mockResolvedValue(STATE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('encryptionQueries', () => {
  it('builds the key hierarchy exactly as pinned', () => {
    expect(encryptionQueries.all()).toEqual(['encryption']);
    expect(encryptionQueries.state().queryKey).toEqual(['encryption', 'state']);
  });

  it('fetches the encryption state across the module boundary', async () => {
    const options = encryptionQueries.state();

    await options.queryFn?.({
      queryKey: options.queryKey,
      signal: new AbortController().signal,
      meta: undefined,
      client: undefined as never,
    });

    expect(mockedFetchEncryptionState).toHaveBeenCalledWith();
  });
});
