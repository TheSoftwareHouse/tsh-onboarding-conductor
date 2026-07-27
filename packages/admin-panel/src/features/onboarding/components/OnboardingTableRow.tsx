import type { ReactElement } from 'react';
import type { AdminOnboardingSummary } from '../types/admin-onboarding';
import {
  formatDateTime,
  formatNullableDateTime,
  formatNullableText,
} from '@/shared/lib/format-date-time';

export interface OnboardingTableRowProps {
  record: AdminOnboardingSummary;
}

/** Renders one lifecycle-safe onboarding row across the nine agreed columns. */
export function OnboardingTableRow({ record }: OnboardingTableRowProps): ReactElement {
  return (
    <tr>
      <td className="identifier">{record.onboardingId}</td>
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
