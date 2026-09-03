import { Fragment, type ReactElement } from 'react';
import {
  formatDateTime,
  formatNullableDateTime,
  formatNullableText,
} from '@/shared/lib/format-date-time';
import { describeAdminOnboardingStatus } from '../types/admin-onboarding';
import type { AdminOnboardingDetail } from '../types/admin-onboarding';

export interface OnboardingSummaryCardProps {
  summary: AdminOnboardingDetail;
}

/**
 * The per-step contributions on one line, in the order the engine reports them. A step re-entered
 * through a loop appears once, carrying its most recent contribution.
 */
function describeScoreBreakdown(scoreByStep: Readonly<Record<string, number>>): string {
  const entries = Object.entries(scoreByStep);

  if (entries.length === 0) {
    return '—';
  }

  return entries
    .map(([stepName, contribution]) => `${stepName} ${contribution >= 0 ? '+' : ''}${contribution}`)
    .join(' · ');
}

/**
 * The onboarding's own record, as the same key/value pairs the list shows as columns. Rendered as
 * a definition list rather than a one-row table so it stays readable at any width.
 */
export function OnboardingSummaryCard({ summary }: OnboardingSummaryCardProps): ReactElement {
  const entries: readonly (readonly [string, string])[] = [
    ['Onboarding ID', summary.onboardingId],
    ['Workflow ID', summary.workflowId],
    ['Workflow version', String(summary.workflowVersion)],
    ['Status', describeAdminOnboardingStatus(summary.status)],
    ['Current step', formatNullableText(summary.currentStep)],
    ['Score', String(summary.score)],
    ['Score by step', describeScoreBreakdown(summary.scoreByStep)],
    ['Expires at', formatNullableDateTime(summary.expiresAt)],
    ['Created at', formatDateTime(summary.createdAt)],
    ['Updated at', formatDateTime(summary.updatedAt)],
    ['Completed at', formatNullableDateTime(summary.completedAt)],
  ];

  return (
    <section className="detail-card" aria-label="Onboarding record">
      <dl className="metadata-list">
        {entries.map(([label, value]) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}
