/**
 * Thrown for every encryption/decryption failure: a malformed or truncated payload, a flipped
 * ciphertext byte, an AAD mismatch, or a stored envelope encountered while
 * `ENCRYPTION_ENABLED=false`. Never includes the key or plaintext in its message.
 */
export class EncryptionFailedError extends Error {
  constructor(reason: string) {
    super(`Encryption operation failed: ${reason}`);
    this.name = 'EncryptionFailedError';
  }
}
