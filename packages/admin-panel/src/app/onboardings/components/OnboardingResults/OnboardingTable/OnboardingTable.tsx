import type { ReactElement } from 'react';
import { Table, TableEmptyRow, Th } from '@/components/ui/DataTable/DataTable';
import type { AdminOnboardingSummary } from '../../../types/admin-onboarding';
import { OnboardingTableRow } from './OnboardingTableRow/OnboardingTableRow';

const TABLE_COLUMN_COUNT = 9;

export interface OnboardingTableProps {
  showTable: boolean;
  records: AdminOnboardingSummary[];
  emptyMessage: string;
}

/** Renders the semantic results table: caption, column headers, empty-state row, or data rows. */
export function OnboardingTable({
  showTable,
  records,
  emptyMessage,
}: OnboardingTableProps): ReactElement {
  return (
    <Table caption="Onboardings matching the current filters">
      <thead>
        <tr>
          <Th>Onboarding</Th>
          <Th>Workflow</Th>
          <Th>Status</Th>
          <Th>Current step</Th>
          <Th>Started</Th>
          <Th>Last activity</Th>
          <Th>Expires</Th>
          <Th>Completed</Th>
          <Th align="end" />
        </tr>
      </thead>
      <tbody>
        {showTable && records.length === 0 && (
          <TableEmptyRow colSpan={TABLE_COLUMN_COUNT}>{emptyMessage}</TableEmptyRow>
        )}
        {showTable &&
          records.map((record) => <OnboardingTableRow key={record.onboardingId} record={record} />)}
      </tbody>
    </Table>
  );
}
