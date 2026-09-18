/**
 * Thrown by `keyFor` for an id `encryption_keys` genuinely has a row for, but whose wrapped
 * material could not be unwrapped with the configured KEK (`ENCRYPTION_KEY`) the last time
 * `EncryptionKeyRingService.reload()` tried — as opposed to `EncryptionKeyNotFoundError` (an id the
 * ring never saw at all) or `EncryptionFailedError` (a specific ciphertext that failed to decrypt,
 * not a whole key). Only ever raised for a key that was *not* active at reload time: an active
 * key's own unwrap failure is fatal there and never reaches this far. The near-certain cause is
 * that `ENCRYPTION_KEY` changed since this key was wrapped; an operator seeing this should suspect
 * exactly that. Key ids are not secret and may appear in this message; key material never may.
 */
export class EncryptionKeyUnwrapFailedError extends Error {
  constructor(keyId: string) {
    super(
      `Encryption key "${keyId}" exists but could not be unwrapped with the configured ` +
        'ENCRYPTION_KEY; it was excluded from the ring at the last reload — verify the ' +
        'key-encryption key has not changed',
    );
    this.name = 'EncryptionKeyUnwrapFailedError';
  }
}
