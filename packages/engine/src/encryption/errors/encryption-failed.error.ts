/**
 * Thrown for every encryption/decryption failure: a malformed or truncated payload, a flipped
 * ciphertext byte, an AAD mismatch, or a stored envelope met by a process with no key-encryption
 * key configured. Never includes the key or plaintext in its message.
 */
export class EncryptionFailedError extends Error {
  constructor(reason: string) {
    super(`Encryption operation failed: ${reason}`);
    this.name = 'EncryptionFailedError';
  }
}
