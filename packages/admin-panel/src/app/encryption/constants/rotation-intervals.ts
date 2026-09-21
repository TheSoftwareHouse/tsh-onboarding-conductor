import type { EncryptionKeyRotationInterval } from '../types/encryption';

/**
 * Offered in the order an operator reads them: shortest schedule first. Typed as a non-empty
 * tuple so it can be handed straight to `z.enum` at the API boundary, the same way
 * `ENCRYPTION_WRITE_ERROR_CODES` is.
 */
export const ROTATION_INTERVALS: readonly [
  EncryptionKeyRotationInterval,
  ...EncryptionKeyRotationInterval[],
] = ['48h', '96h', '1w', '2w', '1mo'];

/** The engine's tokens as an operator reads them; `1mo` is a fixed 30 days, not a calendar month. */
export const ROTATION_INTERVAL_LABELS: Record<EncryptionKeyRotationInterval, string> = {
  '48h': 'Every 48 hours',
  '96h': 'Every 96 hours',
  '1w': 'Every week',
  '2w': 'Every 2 weeks',
  '1mo': 'Every 30 days',
};
