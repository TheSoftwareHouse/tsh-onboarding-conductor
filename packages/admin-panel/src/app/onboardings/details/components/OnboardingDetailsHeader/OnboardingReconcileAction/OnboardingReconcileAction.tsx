import type { ReactElement } from 'react';
import type { AdminOnboardingPendingConnector } from '@/api/onboardings/admin-onboardings';
import { Button } from '@/components/ui/Button/Button';

export interface OnboardingReconcileActionProps {
  /** The connector the onboarding is parked on; the action has no meaning without one. */
  pendingConnector: AdminOnboardingPendingConnector | null;
  /** True while any header action is in flight, since two writes must not race on one onboarding. */
  disabled: boolean;
  onReconcile: () => void;
}

/** "Check provider": asks the parked connector's provider for its verdict now, rendered only while parked. */
export function OnboardingReconcileAction({
  pendingConnector,
  disabled,
  onReconcile,
}: OnboardingReconcileActionProps): ReactElement | null {
  if (pendingConnector === null) {
    return null;
  }

  return (
    <Button
      variant="secondary"
      size="lg"
      disabled={disabled}
      title={`Ask ${pendingConnector.connectorName} for its verdict`}
      onClick={onReconcile}
    >
      Check provider
    </Button>
  );
}
