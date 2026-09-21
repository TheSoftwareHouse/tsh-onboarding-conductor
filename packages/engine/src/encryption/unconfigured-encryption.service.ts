import { EncryptedPayload, EncryptionPort } from './encryption.port';
import { EncryptionFailedError } from './errors/encryption-failed.error';

/**
 * Bound at bootstrap when this process has no key-encryption key (`ENCRYPTION_KEY`), so it can
 * neither wrap a data key nor unwrap one. `enabled` is therefore always `false` and every write
 * stays plain JSON. `encrypt` must never be reached — the transformer checks `enabled` first — so
 * it throws rather than silently returning plaintext. `decrypt` throws when it meets an envelope
 * written by a process that does hold the key, naming the misconfiguration rather than returning
 * ciphertext as if it were data.
 */
export class UnconfiguredEncryptionService implements EncryptionPort {
  readonly enabled = false;

  encrypt(_plaintext: string, aad: string): EncryptedPayload {
    throw new EncryptionFailedError(
      `encrypt() was called for column "${aad}" with no ENCRYPTION_KEY configured; callers must ` +
        'check `enabled` first',
    );
  }

  decrypt(_payload: string, aad: string, keyId: string): string {
    throw new EncryptionFailedError(
      `column "${aad}" holds an encryption envelope for key "${keyId}" but this process has no ` +
        'ENCRYPTION_KEY configured; configure the same key-encryption key on every engine ' +
        'process to read it',
    );
  }
}
