import type { ReactElement } from 'react';
import type { AdminOnboardingSummary } from '@/entities/onboarding';
import { OnboardingTableRow } from './OnboardingTableRow';

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
    <table>
      <caption className="visually-hidden">Onboardings matching the current filters</caption>
      <thead>
        <tr>
          <th scope="col">Onboarding ID</th>
          <th scope="col">Workflow ID</th>
          <th scope="col">Workflow version</th>
          <th scope="col">Status</th>
          <th scope="col">Current step</th>
          <th scope="col">Expires at</th>
          <th scope="col">Created at</th>
          <th scope="col">Updated at</th>
          <th scope="col">Completed at</th>
        </tr>
      </thead>
      <tbody>
        {showTable && records.length === 0 && (
          <tr className="empty-row">
            <td colSpan={TABLE_COLUMN_COUNT}>{emptyMessage}</td>
          </tr>
        )}
        {showTable &&
          records.map((record) => <OnboardingTableRow key={record.onboardingId} record={record} />)}
      </tbody>
    </table>
  );
}
