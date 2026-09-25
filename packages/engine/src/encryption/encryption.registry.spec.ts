import 'reflect-metadata';
import { EncryptedPayload, EncryptionPort } from './encryption.port';
import {
  clearEncryptionPort,
  requireEncryptionPort,
  setEncryptionPort,
} from './encryption.registry';
import { EncryptionUnavailableError } from './errors/encryption-unavailable.error';

const fakePort = (): EncryptionPort => ({
  enabled: false,
  encryptIfEnabled: (): EncryptedPayload | null => null,
  decrypt: (): string => {
    throw new Error('not used');
  },
});

describe('encryption.registry', () => {
  const first = fakePort();
  const second = fakePort();

  afterEach(() => {
    clearEncryptionPort(first);
    clearEncryptionPort(second);
  });

  it('throws rather than defaulting to a pass-through before a port is bound', () => {
    expect(() => requireEncryptionPort()).toThrow(EncryptionUnavailableError);
  });

  it('throws again once the bound port is cleared, so a closed application leaves nothing live', () => {
    setEncryptionPort(first);
    expect(requireEncryptionPort()).toBe(first);

    clearEncryptionPort(first);

    expect(() => requireEncryptionPort()).toThrow(EncryptionUnavailableError);
  });

  it('ignores a clear from a port that is no longer bound, so a late shutdown cannot unbind its successor', () => {
    // One process, two applications: the second binds while the first is still shutting down.
    // Clearing unconditionally there would leave the running application with no port at all.
    setEncryptionPort(first);
    setEncryptionPort(second);

    clearEncryptionPort(first);

    expect(requireEncryptionPort()).toBe(second);
  });
});
