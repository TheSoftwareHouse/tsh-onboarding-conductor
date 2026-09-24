import type { ReactElement } from 'react';
import type { AdminOnboardingSummary } from '@/api/onboardings/admin-onboardings';
import { MetaStrip, MetaStripItem } from '@/components/ui/MetaStrip/MetaStrip';
import { formatDateTime } from '@/lib/format-date-time';
import { formatDuration } from '@/lib/format-duration';

export interface OnboardingRunMetaProps {
  summary: AdminOnboardingSummary;
  /** The most recent transition's `occurredAt`, which the "In `<step>`" duration is measured from. */
  lastTransitionOccurredAt: string | null;
  /** The instant "now" durations are measured against; defaults to the render instant. */
  now?: Date;
}

/** The run-meta band: Started, Last update, the current step's running duration, Total and Expires. */
export function OnboardingRunMeta({
  summary,
  lastTransitionOccurredAt,
  now = new Date(),
}: OnboardingRunMetaProps): ReactElement {
  const nowIso = now.toISOString();

  return (
    <MetaStrip>
      <MetaStripItem label="Started" value={formatDateTime(summary.createdAt)} />
      <MetaStripItem label="Last update" value={formatDateTime(summary.updatedAt)} />
      {summary.currentStep !== null && (
        <MetaStripItem
          label={`In ${summary.currentStep}`}
          value={formatDuration(lastTransitionOccurredAt ?? summary.createdAt, nowIso)}
          highlighted
        />
      )}
      <MetaStripItem
        label="Total"
        value={formatDuration(summary.createdAt, summary.completedAt ?? nowIso)}
      />
      {summary.expiresAt !== null && (
        <MetaStripItem label="Expires" value={formatDateTime(summary.expiresAt)} />
      )}
    </MetaStrip>
  );
}
