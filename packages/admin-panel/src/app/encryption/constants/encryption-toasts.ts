import type { EncryptionKeyRotationInterval } from '@/api/encryption/admin-encryption';
import { ROTATION_INTERVAL_LABELS } from './rotation-intervals';

/** Which way a toggle went. */
export type EncryptionToggleDirection = 'on' | 'off';

/** The background write a page's `useSettledChangeToast` watches for the Encryption page. */
export type EncryptionPendingChange = EncryptionToggleDirection | 'reencrypt';

/** Progress-toast title once a toggle is accepted; the sweep finishes in the background. */
export const TOGGLE_ACCEPTED_TITLE: Record<EncryptionToggleDirection, string> = {
  on: 'Encryption turned on. Existing onboardings are being encrypted in the background.',
  off: 'Encryption turned off. Existing onboardings are being decrypted in the background.',
};

/** Success-toast title once a toggle's background change settles. */
export const TOGGLE_SETTLED_TITLE: Record<EncryptionToggleDirection, string> = {
  on: 'Encryption is on. Every stored onboarding is encrypted.',
  off: 'Encryption is off. Every stored onboarding is decrypted.',
};

/** Progress-toast title once a re-encrypt request is accepted. */
export const REENCRYPT_ACCEPTED_TITLE =
  'Re-encrypting stored onboardings. This continues in the background; a second toast reports the result.';

/** Success-toast title once the re-encrypt settles. */
export const REENCRYPT_SETTLED_TITLE = 'Every stored onboarding is on the active key.';

/** Success-toast title for turning automatic key rotation off. */
export const ROTATION_OFF_SUCCESS_TITLE =
  'Automatic key rotation turned off. The key now changes only when you add one.';

/** Success-toast title for setting a rotation interval. */
export function rotationSetTitle(interval: EncryptionKeyRotationInterval): string {
  return `Automatic key rotation set to ${ROTATION_INTERVAL_LABELS[interval].toLowerCase()}.`;
}

/** Matches the design's existing add-key copy. */
export const ADD_KEY_SUCCESS_TITLE =
  'Added a new encryption key. New data uses it once it activates; stored onboardings move onto ' +
  'it as they are next written.';

export const UNABLE_TO_TOGGLE_TITLE: Record<EncryptionToggleDirection, string> = {
  on: 'Unable to turn encryption on:',
  off: 'Unable to turn encryption off:',
};

export const UNABLE_TO_CHANGE_ROTATION_TITLE = 'Unable to change automatic key rotation:';
export const UNABLE_TO_ADD_KEY_TITLE = 'Unable to add a key:';
export const UNABLE_TO_REENCRYPT_TITLE = 'Unable to re-encrypt stored onboardings:';
