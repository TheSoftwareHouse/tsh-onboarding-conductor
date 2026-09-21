import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { EncryptionKeyRing } from './encryption-key-ring.service';
import { EncryptedPayload, EncryptionPort } from './encryption.port';
import { EncryptionFailedError } from './errors/encryption-failed.error';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/**
 * Authenticated encryption over `node:crypto`'s AES-256-GCM, bound at bootstrap whenever the
 * key-encryption key is configured. The payload is `base64(iv(12) || authTag(16) || ciphertext)`;
 * `aad` is passed as additional authenticated data so ciphertext moved between columns fails to
 * decrypt instead of silently succeeding.
 *
 * The IV is freshly random per `encrypt` call — reusing an IV under GCM is catastrophic, so it is
 * never derived from the plaintext, a counter, or a row id.
 *
 * Backed by the key ring rather than a single key: `enabled` is whether the ring currently has an
 * active key at all, `encrypt` always uses that key, and `decrypt` resolves whichever key the
 * caller names — which may not be the active one, or there may be none, since a row can carry a
 * key id from before a rotation or from before encryption was turned off. Resolution failures (an
 * id the ring genuinely does not know) propagate as the ring's own `EncryptionKeyNotFoundError`,
 * never rewrapped into `EncryptionFailedError`, so an operator can tell "this key id was never
 * issued" apart from "this ciphertext was tampered with".
 */
export class AesGcmEncryptionService implements EncryptionPort {
  constructor(private readonly ring: EncryptionKeyRing) {}

  /**
   * Follows the ring, per call: `true` exactly while a key is active, so turning encryption on
   * or off from the admin panel changes what the next write does without a restart.
   */
  get enabled(): boolean {
    return this.ring.activeKeyId() !== null;
  }

  encrypt(plaintext: string, aad: string): EncryptedPayload {
    const keyId = this.ring.activeKeyId();

    if (keyId === null) {
      throw new EncryptionFailedError(
        `encrypt() was called for column "${aad}" while no encryption key is active; callers ` +
          'must check `enabled` first',
      );
    }

    const key = this.ring.keyFor(keyId);

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      payload: Buffer.concat([iv, authTag, ciphertext]).toString('base64'),
      keyId,
    };
  }

  decrypt(payload: string, aad: string, keyId: string): string {
    // Resolved before any parsing of `payload`, and left uncaught: an unknown key id is a
    // different failure than a corrupt payload, and the caller needs to be able to tell them
    // apart (see `EncryptionKeyNotFoundError`'s doc comment).
    const key = this.ring.keyFor(keyId);
    const raw = Buffer.from(payload, 'base64');

    if (raw.length < IV_BYTES + AUTH_TAG_BYTES) {
      throw new EncryptionFailedError('payload is too short to contain an IV and auth tag');
    }

    const iv = raw.subarray(0, IV_BYTES);
    const authTag = raw.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES + AUTH_TAG_BYTES);

    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(authTag);

      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // Never surface the underlying node:crypto error: it can include buffer contents, and the
      // caller only needs to know decryption failed, never why at the byte level.
      throw new EncryptionFailedError('ciphertext failed authentication');
    }
  }
}
