/**
 * Thrown when a key id is not known to the in-process ring, even immediately after a fresh
 * reload of `encryption_keys` — the id was never issued to this replica, or names a row that has
 * never existed. Key ids are not secret and may appear in this message; key material never may.
 */
export class EncryptionKeyNotFoundError extends Error {
  constructor(keyId: string) {
    super(`No encryption key found for id "${keyId}"`);
    this.name = 'EncryptionKeyNotFoundError';
  }
}
