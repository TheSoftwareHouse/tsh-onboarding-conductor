/**
 * The application-level encryption seam. One implementation is bound at bootstrap depending on
 * whether the key-encryption key (`ENCRYPTION_KEY`) is configured — `AesGcmEncryptionService`
 * over the key ring when it is, `UnconfiguredEncryptionService` otherwise — and every column
 * transformer resolves it through `encryption.registry.ts` rather than depending on either
 * implementation directly. Whether a write is actually encrypted is *not* settled at bootstrap:
 * `enabled` follows the ring, which follows `encryption_keys`, so an operator turning encryption
 * on or off from the admin panel changes what the next write does without a restart. There is no
 * DI token for this interface: nothing injects an `EncryptionPort` through Nest today, because
 * the only consumers are TypeORM column transformers, which are evaluated at class-definition
 * time, before Nest's injector exists (see `encryption.registry.ts`).
 */

/** What `encrypt` returns: the payload plus the id of the key used to produce it. */
export interface EncryptedPayload {
  payload: string;
  keyId: string;
}

export interface EncryptionPort {
  /**
   * Whether `encrypt` may be called right now — a key is active in the ring. Re-read on every
   * call, never cached by the caller, so a change to the ring takes effect on the next write.
   */
  readonly enabled: boolean;
  /**
   * Encrypts `plaintext` with the ring's currently active key and returns the base64 payload
   * together with that key's id. `aad` binds the ciphertext to the column it was written for, so
   * a value copied into a different column fails to decrypt. The key id travels with the
   * ciphertext (in the envelope) so a later `decrypt` can resolve the exact key that produced it,
   * even after a different key has since become active or encryption has been turned off.
   */
  encrypt(plaintext: string, aad: string): EncryptedPayload;
  /**
   * Decrypts a payload produced by `encrypt`, resolving `keyId` through the key ring. Works
   * whether or not a key is currently active — the ring retains every key's material. Throws if
   * `aad` does not match the value used to encrypt, if the payload has been truncated or tampered
   * with, or if `keyId` is not known to the ring.
   */
  decrypt(payload: string, aad: string, keyId: string): string;
}
