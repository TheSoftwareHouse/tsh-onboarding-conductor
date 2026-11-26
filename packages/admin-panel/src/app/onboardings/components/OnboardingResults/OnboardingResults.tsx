import type { ReactElement, ReactNode } from 'react';
import type { AdminOnboardingSummary } from '@/api/onboardings/admin-onboardings';
import { TableResults } from '@/components/ui/TableResults/TableResults';
import type { PaginationWindow } from '@/lib/pagination';
import { OnboardingTable } from './OnboardingTable/OnboardingTable';

export interface OnboardingResultsProps {
  /** Null hides the footer. */
  statusMessage: string | null;
  /** Replaces the rows and the footer. */
  state?: ReactNode;
  visibleRecords: AdminOnboardingSummary[];
  /** Null while no page window is available, which also hides the pager. */
  pagination: PaginationWindow | null;
  paginationDisabled: boolean;
  onPageChange: (page: number) => void;
}

/** Thin wrapper binding the shared results band to the onboardings table. */
export function OnboardingResults({
  statusMessage,
  state,
  visibleRecords,
  pagination,
  paginationDisabled,
  onPageChange,
}: OnboardingResultsProps): ReactElement {
  return (
    <TableResults
      statusMessage={statusMessage}
      regionLabel="Onboardings results"
      paginationLabel="Onboarding pages"
      state={state}
      pagination={pagination}
      paginationDisabled={paginationDisabled}
      onPageChange={onPageChange}
    >
      <OnboardingTable records={visibleRecords} />
    </TableResults>
  );
}
