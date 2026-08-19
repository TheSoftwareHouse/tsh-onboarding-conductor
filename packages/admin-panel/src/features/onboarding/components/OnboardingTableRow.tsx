import type { ReactElement } from 'react';
import { Link } from 'react-router';
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
 * Renders one lifecycle-safe onboarding row across the nine agreed columns. The identifier is a
 * link to the onboarding's details, so opening one is a plain navigation an operator can
 * middle-click, and the row stays selectable text everywhere else.
 */
export function OnboardingTableRow({ record }: OnboardingTableRowProps): ReactElement {
  return (
    <tr>
      <td className="identifier">
        <Link className="link" to={buildOnboardingDetailsPath(record.onboardingId)}>
          {record.onboardingId}
        </Link>
      </td>
      <td className="identifier">{record.workflowId}</td>
      <td className="identifier">{record.workflowVersion}</td>
      <td className="identifier">{record.status}</td>
      <td className="description">{formatNullableText(record.currentStep)}</td>
      <td className="timestamp">{formatNullableDateTime(record.expiresAt)}</td>
      <td className="timestamp">{formatDateTime(record.createdAt)}</td>
      <td className="timestamp">{formatDateTime(record.updatedAt)}</td>
      <td className="timestamp">{formatNullableDateTime(record.completedAt)}</td>
    </tr>
  );
}
