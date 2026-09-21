import type { ChipTone } from '@/components/ui/Chip/Chip';
import type { EncryptionState } from '../types/encryption';

/**
 * What the ring is doing right now, rather than what the operator asked for: `enabled` is the
 * target state, and the sweep that gets there — plus the activation grace window on the way on —
 * means the two disagree for a few seconds after every toggle.
 */
export type EncryptionDisplayStatus = 'on' | 'turning-on' | 'turning-off' | 'off';

export const ENCRYPTION_STATUS_LABELS: Record<EncryptionDisplayStatus, string> = {
  on: 'On',
  'turning-on': 'Turning on',
  'turning-off': 'Turning off',
  off: 'Off',
};

/** `strong` for the settled on state, amber while a change is in flight, plain while off. */
export const ENCRYPTION_STATUS_TONES: Record<EncryptionDisplayStatus, ChipTone> = {
  on: 'strong',
  'turning-on': 'attention',
  'turning-off': 'attention',
  off: 'neutral',
};

export function describeEncryptionStatus(state: EncryptionState): EncryptionDisplayStatus {
  const hasActiveKey = state.keys.some((key) => key.active);

  if (state.enabled) {
    return hasActiveKey ? 'on' : 'turning-on';
  }

  return hasActiveKey ? 'turning-off' : 'off';
}
