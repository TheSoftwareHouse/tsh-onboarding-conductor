import type { ReactElement } from 'react';
import { Link, useLocation } from 'react-router';
import { buildOnboardingDetailsPath } from '../constants/routes';
import type { AdminOnboardingSummary } from '../types/admin-onboarding';
import {
  formatDateTime,
  formatNullableDateTime,
  formatNullableText,
} from '@/shared/lib/format-date-time';

export interface OnboardingTableRowProps {
  record: AdminOnboardingSummary;
}

/**
 * Renders one lifecycle-safe onboarding row across the ten agreed columns. The identifier is a
 * link to the onboarding's details, so opening one is a plain navigation an operator can
 * middle-click, and the row stays selectable text everywhere else.
 */
export function OnboardingTableRow({ record }: OnboardingTableRowProps): ReactElement {
  // The list carries its committed filters in its query string, and the details page hands the
  // same string back on its way out, so returning lands on the filtered list the row came from.
  const { search } = useLocation();

  return (
    <tr>
      <td className="identifier">
        <Link
          className="link"
          to={{ pathname: buildOnboardingDetailsPath(record.onboardingId), search }}
        >
          {record.onboardingId}
        </Link>
      </td>
      <td className="identifier">{record.workflowId}</td>
      <td className="identifier">{record.workflowVersion}</td>
      <td className="identifier">{record.status}</td>
      <td className="description">{formatNullableText(record.currentStep)}</td>
      <td className="identifier">{record.score}</td>
      <td className="timestamp">{formatNullableDateTime(record.expiresAt)}</td>
      <td className="timestamp">{formatDateTime(record.createdAt)}</td>
      <td className="timestamp">{formatDateTime(record.updatedAt)}</td>
      <td className="timestamp">{formatNullableDateTime(record.completedAt)}</td>
    </tr>
  );
}
