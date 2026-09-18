import { EncryptedPayload, EncryptionPort } from './encryption.port';
import { EncryptionFailedError } from './errors/encryption-failed.error';

/**
 * Bound at bootstrap when `ENCRYPTION_ENABLED=false`. `encrypt` must never be reached — the
 * transformer checks `enabled` before calling it — so it throws rather than silently returning
 * plaintext. `decrypt` throws when it encounters an envelope written while encryption was on,
 * naming the situation rather than returning ciphertext as if it were data.
 */
export class DisabledEncryptionService implements EncryptionPort {
  readonly enabled = false;

  encrypt(plaintext: string, aad: string): EncryptedPayload {
    throw new EncryptionFailedError(
      `encrypt() was called for column "${aad}" while ENCRYPTION_ENABLED=false; callers must ` +
        'check `enabled` first',
    );
  }

  decrypt(_payload: string, aad: string, keyId: string): string {
    throw new EncryptionFailedError(
      `column "${aad}" holds an encryption envelope for key "${keyId}" but ` +
        'ENCRYPTION_ENABLED=false; set ENCRYPTION_ENABLED=true with the original ENCRYPTION_KEY ' +
        'to read it',
    );
  }
}
