import type { ReactElement } from 'react';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import type { EncryptionProgress } from '../../types/encryption';

export interface SweepProgressProps {
  /** Which way the sweep is moving data: onto the active key, or back to plain JSON. */
  enabled: boolean;
  progress: EncryptionProgress;
}

/**
 * The background sweep's own progress line. Shown only while `pending` is above zero — once every
 * onboarding has been moved there is nothing left to report, and an operator should not have to
 * wonder whether a permanent "0 remaining" means the same thing as this line being gone. Nothing
 * pushes progress to the client; `useEncryption` re-reads it every few seconds for as long as
 * this line has something to show.
 */
export function SweepProgress({ enabled, progress }: SweepProgressProps): ReactElement | null {
  if (progress.pending <= 0) {
    return null;
  }

  const done = progress.total - progress.pending;
  const counts = `${done} of ${progress.total} done, ${progress.pending} remaining.`;

  return (
    <StatusRegion>
      {enabled
        ? `Encrypting stored onboardings onto the active key: ${counts}`
        : `Decrypting stored onboardings: ${counts}`}
    </StatusRegion>
  );
}
