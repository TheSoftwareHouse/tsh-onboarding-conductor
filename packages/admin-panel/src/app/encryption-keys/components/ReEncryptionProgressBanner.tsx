import type { ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import type { ReEncryptionProgress } from '../types/encryption-key';

export interface ReEncryptionProgressBannerProps {
  progress: ReEncryptionProgress;
  /**
   * Re-reads the key list, including the derived progress, on demand. The sweep runs in the
   * background with nothing that pushes its progress to the client, so the operator asks for a
   * fresh read explicitly instead of the page polling one in on its own.
   */
  onRefresh: () => void;
}

/**
 * The sweep's own progress line. Shown only while `pending` is above zero — once the background
 * sweep has moved every onboarding context onto the active key there is nothing left to report,
 * and an operator should not have to wonder whether a permanent line reading "0 remaining" means
 * the same thing as this line being gone. The Refresh control sits beside it for the same reason:
 * it disappears with the banner, so there is nothing left to click once progress has reached zero.
 */
export function ReEncryptionProgressBanner({
  progress,
  onRefresh,
}: ReEncryptionProgressBannerProps): ReactElement | null {
  if (progress.pending <= 0) {
    return null;
  }

  const done = progress.total - progress.pending;

  return (
    <div className="encryption-keys__progress-row">
      <p className="encryption-keys__progress text-body-sm text-fg-3" role="status">
        Re-encrypting existing onboarding data onto the new key: {done} of {progress.total} done,{' '}
        {progress.pending} remaining.
      </p>
      <Button variant="quiet" size="sm" onClick={onRefresh}>
        Refresh
      </Button>
    </div>
  );
}
