import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { SectionHeader } from '@/components/ui/SectionHeader/SectionHeader';
import { Typography } from '@/components/ui/Typography/Typography';
import { ADMIN_ROUTES } from '@/constants/routes';
import { isFailureAuditAction } from '@/lib/audit-actions';
import { formatAuditMetadataValue } from '@/lib/audit-metadata';
import {
  ONBOARDING_AUDIT_RESOURCE_TYPE,
  serializeAuditResourceSearch,
} from '@/lib/audit-search-params';
import { cn } from '@/lib/cn';
import {
  useOnboardingActivity,
  type OnboardingActivityEntry,
  type UseOnboardingActivityResult,
} from '../../hooks/useOnboardingActivity';

export interface OnboardingActivityLogProps {
  onboardingId: string;
}

const ACTIVITY_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
});
const ACTIVITY_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const ACTIVITY_METADATA_MAX_PAIRS = 3;
const ACTIVITY_METADATA_MAX_VALUE_LENGTH = 40;
const NO_METADATA_TEXT = 'No further detail recorded.';

/** Clips a rendered value so one long pair cannot dominate the row's single line. */
function truncateActivityMetadataValue(value: string): string {
  return value.length > ACTIVITY_METADATA_MAX_VALUE_LENGTH
    ? `${value.slice(0, ACTIVITY_METADATA_MAX_VALUE_LENGTH)}…`
    : value;
}

function joinActivityMetadataPairs(
  entries: [string, unknown][],
  formatValue: (value: unknown) => string,
): string {
  return entries.length === 0
    ? NO_METADATA_TEXT
    : entries.map(([key, value]) => `${key}: ${formatValue(value)}`).join(' · ');
}

/** The row's one-line summary — capped pairs, each value clipped, per `.claude/rules/constants.md`. */
function summarizeActivityMetadata(metadata: Record<string, unknown>): string {
  const entries = Object.entries(metadata).slice(0, ACTIVITY_METADATA_MAX_PAIRS);

  return joinActivityMetadataPairs(entries, (value) =>
    truncateActivityMetadataValue(formatAuditMetadataValue(value)),
  );
}

/** The uncapped summary, kept in `title` so an operator can still read it all on hover. */
function summarizeActivityMetadataFully(metadata: Record<string, unknown>): string {
  return joinActivityMetadataPairs(Object.entries(metadata), formatAuditMetadataValue);
}

/** The trail filtered to this onboarding, serialized from the criteria the Logs route reads back. */
function buildAuditLogHref(onboardingId: string): string {
  const search = serializeAuditResourceSearch({
    resourceType: ONBOARDING_AUDIT_RESOURCE_TYPE,
    resourceId: onboardingId,
  });

  return `${ADMIN_ROUTES.audit.root}${search}`;
}

function ActivityRow({ entry }: { entry: OnboardingActivityEntry }): ReactElement {
  const occurredAt = new Date(entry.occurredAt);

  return (
    <li className="flex gap-4 border-b border-border-hair py-4 last:border-b-0">
      <div className="flex w-26 flex-none flex-col gap-0.5">
        <Typography
          variant="meta"
          as="span"
          className="font-mono font-normal tracking-normal text-fg-3"
        >
          {ACTIVITY_DATE_FORMATTER.format(occurredAt)}
        </Typography>
        <Typography variant="meta" as="span" className="font-mono font-normal tracking-normal">
          {ACTIVITY_TIME_FORMATTER.format(occurredAt)}
        </Typography>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <Typography
          variant="mono"
          className={cn(isFailureAuditAction(entry.action) ? 'text-tsh-red' : 'text-fg-1')}
        >
          {entry.action}
        </Typography>
        <Typography
          variant="body-sm"
          className="truncate"
          title={summarizeActivityMetadataFully(entry.metadata)}
        >
          {summarizeActivityMetadata(entry.metadata)}
        </Typography>
      </div>
    </li>
  );
}

function SeeInLogsLink({ href, children }: { href: string; children: string }): ReactElement {
  return (
    <Link to={href}>
      <Typography variant="body-sm" as="span" className="text-fg-1">
        {children}
      </Typography>
    </Link>
  );
}

interface ActivityLogBodyProps {
  activity: UseOnboardingActivityResult;
  logsHref: string;
}

/** The band's content for exactly one state: loading, failed, empty or entries. */
function ActivityLogBody({ activity, logsHref }: ActivityLogBodyProps): ReactElement {
  const { phase, entries, total, error } = activity;

  if (phase === 'loading') {
    return <Typography variant="body-sm">Loading activity…</Typography>;
  }

  if (phase === 'error') {
    return <Typography variant="body-sm">Unable to load activity: {error}</Typography>;
  }

  if (entries.length === 0) {
    return (
      <Typography variant="body-sm">
        No activity has been recorded for this onboarding yet.
      </Typography>
    );
  }

  return (
    <>
      <ol>
        {entries.map((entry) => (
          <ActivityRow key={entry.id} entry={entry} />
        ))}
      </ol>
      <div className="mt-4">
        <SeeInLogsLink href={logsHref}>{`→ See all ${total} entries in Logs`}</SeeInLogsLink>
      </div>
    </>
  );
}

/** The History tab's second band: the audit trail filed against this onboarding, newest first. */
export function OnboardingActivityLog({ onboardingId }: OnboardingActivityLogProps): ReactElement {
  const activity = useOnboardingActivity(onboardingId);
  const { phase, entries, total } = activity;
  const logsHref = buildAuditLogHref(onboardingId);

  return (
    <section aria-label="Activity log">
      <SectionHeader
        title="Activity log"
        meta={phase === 'ready' ? `${entries.length} of ${total} entries` : undefined}
        trailing={<SeeInLogsLink href={logsHref}>→ See in Logs</SeeInLogsLink>}
      />
      <div className="px-8 py-4">
        <ActivityLogBody activity={activity} logsHref={logsHref} />
      </div>
    </section>
  );
}
