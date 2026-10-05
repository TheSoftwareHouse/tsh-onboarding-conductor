import type { ReactElement } from 'react';
import { useLocation } from 'react-router';
import type { AdminOnboardingSummary } from '@/api/onboardings/admin-onboardings';
import { LinkedRow, RowLink, Td } from '@/components/ui/DataTable/DataTable';
import { ArrowForward } from '@/components/ui/icons';
import { formatDateTime, formatNullableDateTime, formatNullableText } from '@/lib/format-date-time';
import { ADMIN_ROUTES } from '@/constants/routes';
import { OnboardingStatusChip } from '../../../OnboardingStatusChip/OnboardingStatusChip';

export interface OnboardingTableRowProps {
  record: AdminOnboardingSummary;
}

/** One row across the nine agreed columns; the identifier's link covers the whole row. */
export function OnboardingTableRow({ record }: OnboardingTableRowProps): ReactElement {
  // The list carries its committed filters in its query string, and the details page hands the
  // same string back on its way out, so returning lands on the filtered list the row came from.
  const { search } = useLocation();
  const detailsTarget = {
    pathname: ADMIN_ROUTES.onboardings.details(record.onboardingId),
    search,
  };

  return (
    <LinkedRow>
      <Td variant="mono" className="text-fg-1">
        <RowLink to={detailsTarget}>{record.onboardingId}</RowLink>
      </Td>
      <Td variant="nowrap" className="text-fg-2">
        {record.workflowId}{' '}
        <span className="font-mono text-mono text-fg-3">v{record.workflowVersion}</span>
      </Td>
      <Td>
        <OnboardingStatusChip status={record.status} />
      </Td>
      <Td variant="mono">{formatNullableText(record.currentStep)}</Td>
      <Td variant="nowrap">{formatDateTime(record.createdAt)}</Td>
      <Td variant="nowrap">{formatDateTime(record.updatedAt)}</Td>
      <Td variant="nowrap">{formatNullableDateTime(record.expiresAt)}</Td>
      <Td variant="nowrap">{formatNullableDateTime(record.completedAt)}</Td>
      <Td variant="end">
        <span className="inline-flex">
          <ArrowForward aria-hidden className="size-4.5 text-tsh-gray-400" />
        </span>
      </Td>
    </LinkedRow>
  );
}
