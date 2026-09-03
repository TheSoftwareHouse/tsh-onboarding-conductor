import type { ReactElement } from 'react';
import type { AdminOnboardingSummary } from '../types/admin-onboarding';
import type {
  AdminOnboardingSortDirection,
  AdminOnboardingSortField,
} from '../utils/filter-admin-onboardings';
import { OnboardingTableRow } from './OnboardingTableRow';

const TABLE_COLUMN_COUNT = 10;

export interface OnboardingTableProps {
  showTable: boolean;
  records: AdminOnboardingSummary[];
  emptyMessage: string;
  /** The column the list is currently ordered by, and in which direction. */
  sortBy: AdminOnboardingSortField;
  sortDir: AdminOnboardingSortDirection;
  onSort: (field: AdminOnboardingSortField) => void;
}

/** Renders the semantic results table: caption, column headers, empty-state row, or data rows. */
export function OnboardingTable({
  showTable,
  records,
  emptyMessage,
  sortBy,
  sortDir,
  onSort,
}: OnboardingTableProps): ReactElement {
  const sortableHeader = (field: AdminOnboardingSortField, label: string): ReactElement => {
    const active = sortBy === field;

    return (
      <th scope="col" aria-sort={!active ? 'none' : sortDir === 'asc' ? 'ascending' : 'descending'}>
        <button type="button" className="link" onClick={() => onSort(field)}>
          {label}
          {active && (sortDir === 'asc' ? ' ▲' : ' ▼')}
        </button>
      </th>
    );
  };

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
          {sortableHeader('score', 'Score')}
          <th scope="col">Expires at</th>
          {sortableHeader('createdAt', 'Created at')}
          <th scope="col">Updated at</th>
          {sortableHeader('completedAt', 'Completed at')}
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
