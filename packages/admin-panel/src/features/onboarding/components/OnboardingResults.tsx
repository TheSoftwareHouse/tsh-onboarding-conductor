import type { ReactElement } from 'react';
import { TableResults } from '@/shared/components/TableResults/TableResults';
import type { PaginationWindow } from '@/shared/lib/pagination';
import type { AdminOnboardingSummary } from '../types/admin-onboarding';
import { OnboardingTable } from './OnboardingTable';

export interface OnboardingResultsProps {
  statusMessage: string;
  showTable: boolean;
  visibleRecords: AdminOnboardingSummary[];
  emptyMessage: string;
  /** Null while no page window is available, which also hides the pager. */
  pagination: PaginationWindow | null;
  paginationDisabled: boolean;
  onPageChange: (page: number) => void;
}

/** Thin wrapper binding the shared results band to the onboardings table. */
export function OnboardingResults({
  statusMessage,
  showTable,
  visibleRecords,
  emptyMessage,
  pagination,
  paginationDisabled,
  onPageChange,
}: OnboardingResultsProps): ReactElement {
  return (
    <TableResults
      statusMessage={statusMessage}
      regionLabel="Onboardings results"
      paginationLabel="Onboarding pages"
      showTable={showTable}
      pagination={pagination}
      paginationDisabled={paginationDisabled}
      onPageChange={onPageChange}
    >
      <OnboardingTable showTable={showTable} records={visibleRecords} emptyMessage={emptyMessage} />
    </TableResults>
  );
}
