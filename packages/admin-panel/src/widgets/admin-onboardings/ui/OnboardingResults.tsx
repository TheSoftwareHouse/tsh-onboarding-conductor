import type { ReactElement } from 'react';
import type { AdminOnboardingSummary } from '@/entities/onboarding';
import { OnboardingTable } from './OnboardingTable';

export interface OnboardingResultsProps {
  statusMessage: string;
  showTable: boolean;
  visibleRecords: AdminOnboardingSummary[];
  emptyMessage: string;
}

/** Renders the polite live-region status message and the bounded, scrollable results table. */
export function OnboardingResults({
  statusMessage,
  showTable,
  visibleRecords,
  emptyMessage,
}: OnboardingResultsProps): ReactElement {
  return (
    <>
      <p className="status-region" role="status" aria-live="polite">
        {statusMessage}
      </p>
      <div
        className="table-wrapper"
        tabIndex={0}
        role="region"
        aria-label="Onboardings results"
        hidden={!showTable}
      >
        <OnboardingTable
          showTable={showTable}
          records={visibleRecords}
          emptyMessage={emptyMessage}
        />
      </div>
    </>
  );
}
