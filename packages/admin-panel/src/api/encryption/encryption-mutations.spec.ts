import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addEncryptionKey,
  requestReencryption,
  setEncryptionEnabled,
  setEncryptionRotationInterval,
  type EncryptionState,
} from './admin-encryption';
import { encryptionMutations } from './encryption-mutations';

vi.mock('./admin-encryption', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./admin-encryption')>()),
  setEncryptionEnabled: vi.fn(),
  setEncryptionRotationInterval: vi.fn(),
  addEncryptionKey: vi.fn(),
  requestReencryption: vi.fn(),
}));

const STATE: EncryptionState = {
  enabled: true,
  keyConfigured: true,
  keys: [],
  rotation: { interval: null, nextRotationAt: null },
  progress: { pending: 0, total: 0 },
  reencrypting: false,
};

const CONTEXT = { client: undefined as never, meta: undefined };

beforeEach(() => {
  vi.mocked(setEncryptionEnabled).mockReset().mockResolvedValue(STATE);
  vi.mocked(setEncryptionRotationInterval).mockReset().mockResolvedValue(STATE);
  vi.mocked(addEncryptionKey).mockReset().mockResolvedValue('key-1');
  vi.mocked(requestReencryption).mockReset().mockResolvedValue(STATE);
});

describe('encryptionMutations', () => {
  it('declares no meta on any write', () => {
    for (const build of Object.values(encryptionMutations)) {
      expect(build().meta).toBeUndefined();
    }
  });

  it('toggles encryption across the module boundary', async () => {
    await encryptionMutations.setEnabled().mutationFn?.(true, CONTEXT);

    expect(setEncryptionEnabled).toHaveBeenCalledWith(true);
  });

  it('sets the rotation interval across the module boundary', async () => {
    await encryptionMutations.setRotationInterval().mutationFn?.('48h', CONTEXT);

    expect(setEncryptionRotationInterval).toHaveBeenCalledWith('48h');
  });

  it('adds a key across the module boundary', async () => {
    await expect(encryptionMutations.addKey().mutationFn?.(undefined, CONTEXT)).resolves.toBe(
      'key-1',
    );

    expect(addEncryptionKey).toHaveBeenCalledWith();
  });

  it('requests re-encryption across the module boundary', async () => {
    await encryptionMutations.reencrypt().mutationFn?.(undefined, CONTEXT);

    expect(requestReencryption).toHaveBeenCalledWith();
  });
});
