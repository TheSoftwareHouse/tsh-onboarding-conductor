import type { ReactElement } from 'react';
import { Link, useLocation } from 'react-router';
import { Td } from '@/shared/components/DataTable/DataTable';
import { ArrowForward } from '@/shared/components/icons';
import {
  formatDateTime,
  formatNullableDateTime,
  formatNullableText,
} from '@/shared/lib/format-date-time';
import { ADMIN_ROUTES } from '@/shared/constants/routes';
import type { AdminOnboardingSummary } from '../types/admin-onboarding';
import { OnboardingStatusChip } from './OnboardingStatusChip';

export interface OnboardingTableRowProps {
  record: AdminOnboardingSummary;
}

/** One row across the nine agreed columns; the identifier stays a `<Link>` so it is middle-clickable. */
export function OnboardingTableRow({ record }: OnboardingTableRowProps): ReactElement {
  // The list carries its committed filters in its query string, and the details page hands the
  // same string back on its way out, so returning lands on the filtered list the row came from.
  const { search } = useLocation();
  const detailsTarget = {
    pathname: ADMIN_ROUTES.onboardings.details(record.onboardingId),
    search,
  };

  return (
    <tr className="hover:bg-bg-subtle">
      <Td variant="mono" className="text-fg-1">
        <Link to={detailsTarget}>{record.onboardingId}</Link>
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
        <Link
          to={detailsTarget}
          aria-label={`Open onboarding ${record.onboardingId}`}
          className="inline-flex"
        >
          <ArrowForward aria-hidden className="size-4.5 text-tsh-gray-400" />
        </Link>
      </Td>
    </tr>
  );
}
