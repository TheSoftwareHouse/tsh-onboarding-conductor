import type { EncryptionKeyRotationInterval } from '@/api/encryption/admin-encryption';

/** The engine's tokens as an operator reads them; `1mo` is a fixed 30 days, not a calendar month. */
export const ROTATION_INTERVAL_LABELS: Record<EncryptionKeyRotationInterval, string> = {
  '48h': 'Every 48 hours',
  '96h': 'Every 96 hours',
  '1w': 'Every week',
  '2w': 'Every 2 weeks',
  '1mo': 'Every 30 days',
};
