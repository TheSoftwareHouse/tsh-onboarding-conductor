import { createParser, createSerializer, parseAsStringLiteral, type inferParserType } from 'nuqs';
import {
  parseAsTrimmedString,
  parseAsPageNumber,
  parseAsPageSize,
  trimmedOrNull,
} from '@/lib/search-params';
import { onboardingWorkflowSearchParams } from '@/lib/onboarding-search-params';
import { ADMIN_ONBOARDING_STATUSES } from '@/api/onboardings/admin-onboardings';
import {
  isValidConnectorId,
  isValidWorkflowVersion,
  toIsoInstant,
  type AdminOnboardingFilters,
} from './filter-admin-onboardings';

/** Trims like any free-text criterion, then falls back to absent for anything that is not a positive whole number. See ADR 0018. */
const workflowVersionParser = createParser<string>({
  parse: (value) => {
    const trimmed = trimmedOrNull(value);
    return trimmed !== null && isValidWorkflowVersion(trimmed) ? trimmed : null;
  },
  serialize: (value) => value,
});

/** `false` also means "no filter", so only the literal `true` parses to a value; anything else falls back to `null` per ADR 0018. */
const parkedParser = createParser<true>({
  parse: (value) => (value === 'true' ? true : null),
  serialize: () => 'true',
});

/** Trims like any free-text criterion, then falls back to absent for anything the engine's connector id pattern refuses. */
const pendingConnectorIdParser = createParser<string>({
  parse: (value) => {
    const trimmed = trimmedOrNull(value);
    return trimmed !== null && isValidConnectorId(trimmed) ? trimmed : null;
  },
  serialize: (value) => value,
});

/** Rejects a bound the calendar control could not have produced; anything else passes through unparsed, as the Logs bounds do. */
const parkedBeforeParser = createParser<string>({
  parse: (value) => (toIsoInstant(value) === null ? null : value),
  serialize: (value) => value,
});

/** One nuqs parser per URL key; see ADR 0018 for the per-key fallback behaviour. */
export const adminOnboardingsSearchParams = {
  status: parseAsStringLiteral(ADMIN_ONBOARDING_STATUSES),
  ...onboardingWorkflowSearchParams,
  workflowVersion: workflowVersionParser,
  currentStep: parseAsTrimmedString,
  onboardingId: parseAsTrimmedString,
  parked: parkedParser,
  pendingConnectorId: pendingConnectorIdParser,
  parkedBefore: parkedBeforeParser,
  page: parseAsPageNumber,
  limit: parseAsPageSize,
};

/** State `useQueryStates(adminOnboardingsSearchParams, ...)` reads and writes. */
export type AdminOnboardingsSearchValues = inferParserType<typeof adminOnboardingsSearchParams>;

const serialize = createSerializer(adminOnboardingsSearchParams);

/** Filters as the URL states them, owning the `?? ''` the controls need. */
export function toAdminOnboardingFilters(
  state: AdminOnboardingsSearchValues,
): AdminOnboardingFilters {
  return {
    status: state.status ?? '',
    workflowId: state.workflowId ?? '',
    workflowVersion: state.workflowVersion ?? '',
    currentStep: state.currentStep ?? '',
    onboardingId: state.onboardingId ?? '',
    parked: state.parked ?? false,
    pendingConnectorId: state.pendingConnectorId ?? '',
    parkedBefore: state.parkedBefore ?? '',
    limit: state.limit,
  };
}

/**
 * Shared by `serializeAdminOnboardingsSearch` and `useAppliedAdminOnboardingFilters`'s commit, so
 * a committed URL and a query key derived from the same criteria are always built the same way.
 */
export function toAdminOnboardingsSearchValues(
  filters: AdminOnboardingFilters,
  page: number,
): AdminOnboardingsSearchValues {
  return {
    status: filters.status || null,
    workflowId: trimmedOrNull(filters.workflowId),
    workflowVersion: trimmedOrNull(filters.workflowVersion),
    currentStep: trimmedOrNull(filters.currentStep),
    onboardingId: trimmedOrNull(filters.onboardingId),
    parked: filters.parked ? true : null,
    pendingConnectorId: trimmedOrNull(filters.pendingConnectorId),
    parkedBefore: trimmedOrNull(filters.parkedBefore),
    limit: filters.limit,
    page,
  };
}

/** Query string a committed filter set and page are carried in, '' when nothing differs from default. */
export function serializeAdminOnboardingsSearch(
  filters: AdminOnboardingFilters,
  page: number,
): string {
  return serialize(toAdminOnboardingsSearchValues(filters, page));
}
