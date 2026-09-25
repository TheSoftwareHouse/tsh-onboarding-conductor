import { useQuery } from '@tanstack/react-query';
import { auditQueries } from '@/api/audit/audit-queries';
import type { AuditEvent, AuditEventQueryFilters } from '@/api/audit/audit-events';
import { ONBOARDING_AUDIT_RESOURCE_TYPE } from '@/lib/audit-search-params';
import { DEFAULT_PAGE } from '@/lib/pagination';

/** Entries the design's activity log band shows; matches the count in `design-details.html`. */
const ACTIVITY_LOG_ENTRY_LIMIT = 6;

/** The four `AuditEvent` fields this band renders — the shared type is a superset of these. */
export interface OnboardingActivityEntry {
  id: string;
  occurredAt: string;
  action: string;
  metadata: Record<string, unknown>;
}

const NO_ENTRIES: OnboardingActivityEntry[] = [];

export type OnboardingActivityPhase = 'loading' | 'error' | 'ready';

export interface UseOnboardingActivityResult {
  phase: OnboardingActivityPhase;
  entries: OnboardingActivityEntry[];
  /** Total the endpoint reports, which may exceed `entries.length`. */
  total: number;
  error: string | null;
}

/** This band's request: the trail scoped to one onboarding, every other criterion absent. */
function toActivityQueryFilters(onboardingId: string): AuditEventQueryFilters {
  return {
    page: DEFAULT_PAGE,
    limit: ACTIVITY_LOG_ENTRY_LIMIT,
    actorType: null,
    actorId: null,
    action: null,
    resourceType: ONBOARDING_AUDIT_RESOURCE_TYPE,
    resourceId: onboardingId,
    occurredPeriod: null,
    occurredFrom: null,
    occurredTo: null,
  };
}

function projectActivityEntry(event: AuditEvent): OnboardingActivityEntry {
  return {
    id: event.id,
    occurredAt: event.occurredAt,
    action: event.action,
    metadata: event.metadata,
  };
}

/** Reads the most recent activity-log entries the audit trail carries for one onboarding. */
export function useOnboardingActivity(onboardingId: string): UseOnboardingActivityResult {
  const query = useQuery(auditQueries.list(toActivityQueryFilters(onboardingId)));
  const { data, isFetching, isError, error } = query;

  return {
    phase: isFetching ? 'loading' : isError ? 'error' : 'ready',
    entries:
      isFetching || isError ? NO_ENTRIES : (data?.events.map(projectActivityEntry) ?? NO_ENTRIES),
    total: data?.pagination.total ?? 0,
    error: error?.message ?? null,
  };
}
