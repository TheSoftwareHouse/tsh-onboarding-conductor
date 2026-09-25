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

/** What `encryptIfEnabled` returns when a key is active: the payload and the id of the key used. */
export interface EncryptedPayload {
  payload: string;
  keyId: string;
}

export interface EncryptionPort {
  /**
   * A cheap, advisory "is a key active right now" — enough to skip serialising a value this
   * process is not going to encrypt. Never a guarantee: the ring resolves activation against the
   * wall clock, so a key can activate or retire between this read and the write that follows.
   * `encryptIfEnabled` is what actually decides, which is why it answers rather than throws.
   */
  readonly enabled: boolean;
  /**
   * Encrypts `plaintext` with the ring's currently active key and returns the base64 payload
   * together with that key's id, or `null` when no key is active and the caller should store the
   * value as it stands. It resolves the active key exactly once, so a key transition landing
   * mid-write — every toggle and every rotation passes through such an instant — stores one row
   * unencrypted for the sweep to pick up, rather than failing a live onboarding write. `aad` binds
   * the ciphertext to the column it was written for, so a value copied into a different column
   * fails to decrypt. The key id travels with the ciphertext (in the envelope) so a later
   * `decrypt` can resolve the exact key that produced it, even after a different key has since
   * become active or encryption has been turned off.
   */
  encryptIfEnabled(plaintext: string, aad: string): EncryptedPayload | null;
  /**
   * Decrypts a payload produced by `encryptIfEnabled`, resolving `keyId` through the key ring. Works
   * whether or not a key is currently active — the ring retains every key's material. Throws if
   * `aad` does not match the value used to encrypt, if the payload has been truncated or tampered
   * with, or if `keyId` is not known to the ring.
   */
  decrypt(payload: string, aad: string, keyId: string): string;
}
