import type { ReactElement } from 'react';
import { Chip } from '@/components/ui/Chip/Chip';
import { Typography } from '@/components/ui/Typography/Typography';
import type { EncryptionState } from '../../types/encryption';
import {
  describeEncryptionStatus,
  ENCRYPTION_STATUS_LABELS,
  ENCRYPTION_STATUS_TONES,
  type EncryptionDisplayStatus,
} from '../../utils/encryption-status';

export interface EncryptionStatusProps {
  state: EncryptionState;
}

const STATUS_COPY: Record<EncryptionDisplayStatus, string> = {
  on: 'New onboarding data is encrypted before it reaches the database.',
  'turning-on':
    'Encryption is being turned on. Every engine process picks the change up within a few seconds.',
  'turning-off':
    'Encryption is being turned off. Every engine process picks the change up within a few seconds.',
  off: 'New onboarding data is stored as plain JSON.',
};

const KEY_NOT_CONFIGURED_COPY =
  'The engine has no ENCRYPTION_KEY configured, so encryption cannot be turned on. Set it and restart the engine.';

/**
 * The one-line answer to "is encryption on?": a chip for the state the ring is actually in, and a
 * sentence on what that means for stored data. A missing key-encryption key replaces the sentence,
 * since nothing else on the page can be acted on until it is set.
 */
export function EncryptionStatus({ state }: EncryptionStatusProps): ReactElement {
  const status = describeEncryptionStatus(state);

  return (
    <section
      aria-label="Encryption status"
      className="flex max-w-2xl flex-col gap-3 border border-border-rule bg-bg-subtle p-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Typography variant="caps-tiny" as="h2" className="text-fg-3">
          Status
        </Typography>
        <Chip tone={ENCRYPTION_STATUS_TONES[status]}>{ENCRYPTION_STATUS_LABELS[status]}</Chip>
      </div>
      <p className="text-body-sm text-fg-2">
        {state.keyConfigured ? STATUS_COPY[status] : KEY_NOT_CONFIGURED_COPY}
      </p>
    </section>
  );
}
