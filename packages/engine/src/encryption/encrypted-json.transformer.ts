import { ValueTransformer } from 'typeorm';
import { requireEncryptionPort } from './encryption.registry';
import { EncryptionFailedError } from './errors/encryption-failed.error';

/** Algorithm + format marker stored in every envelope this transformer writes. */
const ENVELOPE_MARKER = 'aes-256-gcm.v1';

export interface EncryptedJsonEnvelope {
  __tsh_enc: string;
  /** The id of the key this envelope was encrypted with — resolved from the ring on decrypt. */
  k: string;
  d: string;
}

/**
 * Structural, not authenticated: a plaintext value that happens to contain a `__tsh_enc` key
 * would be misread as an envelope by this check alone, which is why `from` throws on a malformed
 * shape rather than guessing.
 */
function hasEnvelopeMarker(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && '__tsh_enc' in value;
}

/**
 * There is no stored data to migrate — the project is greenfield and every earlier encrypted row
 * was deleted — so `k` is required outright. An envelope missing it, or carrying a non-string
 * `k`, is a hard error naming the column: never a guess, and never a fallback to some default key.
 */
function asEnvelope(value: Record<string, unknown>, aad: string): EncryptedJsonEnvelope {
  if (typeof value.__tsh_enc !== 'string' || typeof value.d !== 'string') {
    throw new EncryptionFailedError(
      `stored value in column "${aad}" has a __tsh_enc key but is not a valid envelope`,
    );
  }

  if (typeof value.k !== 'string') {
    throw new EncryptionFailedError(`stored value in column "${aad}" is missing its key id ("k")`);
  }

  return { __tsh_enc: value.__tsh_enc, k: value.k, d: value.d };
}

/**
 * A TypeORM `ValueTransformer` for a `jsonb` column holding either plain JSON or an
 * `EncryptedJsonEnvelope`, depending on `ENCRYPTION_ENABLED` at write time. `aad` binds the
 * envelope to the column it belongs to (for example `'onboardings.context'`) so ciphertext moved
 * into a different column fails to decrypt.
 *
 * The port is resolved lazily, per call, via `requireEncryptionPort()` — TypeORM evaluates
 * `@Column({ transformer })` at class definition time, long before Nest's injector exists, so the
 * transformer cannot receive the port through constructor injection.
 */
export function createEncryptedJsonTransformer(aad: string): ValueTransformer {
  return {
    to(value: unknown): unknown {
      if (value === null || value === undefined) {
        return value;
      }

      const port = requireEncryptionPort();
      if (!port.enabled) {
        return value;
      }

      const { payload, keyId } = port.encrypt(JSON.stringify(value), aad);
      const envelope: EncryptedJsonEnvelope = {
        __tsh_enc: ENVELOPE_MARKER,
        k: keyId,
        d: payload,
      };

      return envelope;
    },
    from(value: unknown): unknown {
      if (value === null || value === undefined) {
        return value;
      }

      if (!hasEnvelopeMarker(value)) {
        return value;
      }

      const envelope = asEnvelope(value, aad);
      const port = requireEncryptionPort();

      // `keyId` may name a key this replica has not learned yet, or one the ring genuinely does
      // not know; either case must surface as the ring's own `EncryptionKeyNotFoundError`, not be
      // swallowed into `EncryptionFailedError` — the operator needs to tell "not loaded yet" apart
      // from "tampered". Neither `port.decrypt` implementation catches that error, so it
      // propagates from here unchanged.
      return JSON.parse(port.decrypt(envelope.d, aad, envelope.k));
    },
  };
}
