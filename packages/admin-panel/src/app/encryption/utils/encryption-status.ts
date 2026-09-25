import type { ChipTone } from '@/components/ui/Chip/Chip';
import type { EncryptionState } from '@/api/encryption/admin-encryption';

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

/**
 * Whether the engine is still working toward the state the operator chose: a key waiting to
 * activate or retire (the grace window, in either direction, or a rotation's incoming key), or
 * rows the background sweep has yet to move. `false` only in a settled state — on with every row
 * on the active key, or off with every row plain — which is when the page has nothing to watch.
 */
export function isEncryptionChangeInFlight(state: EncryptionState): boolean {
  const status = describeEncryptionStatus(state);

  return (
    status === 'turning-on' ||
    status === 'turning-off' ||
    state.reencrypting ||
    state.progress.pending > 0 ||
    state.keys.some((key) => key.pendingActivation)
  );
}
