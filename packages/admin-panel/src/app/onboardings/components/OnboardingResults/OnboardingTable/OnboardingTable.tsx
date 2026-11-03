import type { ReactElement } from 'react';
import type { AdminOnboardingSummary } from '@/api/onboardings/admin-onboardings';
import { Table, Th } from '@/components/ui/DataTable/DataTable';
import { OnboardingTableRow } from './OnboardingTableRow/OnboardingTableRow';

export interface OnboardingTableProps {
  records: AdminOnboardingSummary[];
}

/** Renders the semantic results table: caption, column headers and data rows. */
export function OnboardingTable({ records }: OnboardingTableProps): ReactElement {
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
        {records.map((record) => (
          <OnboardingTableRow key={record.onboardingId} record={record} />
        ))}
      </tbody>
    </Table>
  );
}
