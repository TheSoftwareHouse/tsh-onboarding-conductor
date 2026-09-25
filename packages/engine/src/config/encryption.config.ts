const ENCRYPTION_KEY_BYTES = 32;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Whether `ENCRYPTION_KEY` — the key-encryption key — is present at all. Optional at boot: a
 * deployment that never turns encryption on needs no key, and `docker-compose.yml` forwards the
 * variable as an empty string when `.env` leaves it unset, which counts as absent here.
 */
export function isEncryptionKeyConfigured(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

/**
 * Decodes `ENCRYPTION_KEY` from base64 and enforces it is exactly 32 bytes, the key length
 * AES-256-GCM requires. `validateConfig` calls this for a configured key so a malformed one fails
 * startup rather than the first wrap; the key ring calls it to wrap and unwrap data keys. Never
 * logs, echoes or otherwise exposes the value it is given.
 */
export function parseEncryptionKey(value: string | undefined): Buffer {
  const trimmed = value?.trim() ?? '';

  if (trimmed.length === 0) {
    throw new Error('ENCRYPTION_KEY is not configured');
  }

  if (trimmed.length % 4 !== 0 || !BASE64_PATTERN.test(trimmed)) {
    throw new Error('ENCRYPTION_KEY must be valid base64');
  }

  const decoded = Buffer.from(trimmed, 'base64');

  // Buffer.from('base64') never throws on malformed input, so the round trip above is what
  // actually rejects a string that merely looks like base64 but is not.
  if (decoded.toString('base64') !== trimmed) {
    throw new Error('ENCRYPTION_KEY must be valid base64');
  }

  if (decoded.length !== ENCRYPTION_KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly ${ENCRYPTION_KEY_BYTES} bytes (got ${decoded.length})`,
    );
  }

  return decoded;
}
