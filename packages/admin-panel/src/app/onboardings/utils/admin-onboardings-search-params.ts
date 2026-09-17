import { createParser, createSerializer, parseAsStringLiteral, type inferParserType } from 'nuqs';
import {
  parseAsTrimmedString,
  parseAsPageNumber,
  parseAsPageSize,
  trimmedOrNull,
} from '@/lib/search-params';
import { ADMIN_ONBOARDING_STATUSES } from '../types/admin-onboarding';
import { isValidWorkflowVersion, type AdminOnboardingFilters } from './filter-admin-onboardings';

/** Trims like any free-text criterion, then falls back to absent for anything that is not a positive whole number. See ADR 0018. */
const workflowVersionParser = createParser<string>({
  parse: (value) => {
    const trimmed = trimmedOrNull(value);
    return trimmed !== null && isValidWorkflowVersion(trimmed) ? trimmed : null;
  },
  serialize: (value) => value,
});

/** One nuqs parser per URL key; see ADR 0018 for the per-key fallback behaviour. */
export const adminOnboardingsSearchParams = {
  status: parseAsStringLiteral(ADMIN_ONBOARDING_STATUSES),
  workflowId: parseAsTrimmedString,
  workflowVersion: workflowVersionParser,
  currentStep: parseAsTrimmedString,
  onboardingId: parseAsTrimmedString,
  page: parseAsPageNumber,
  limit: parseAsPageSize,
};

/**
 * State `useQueryStates(adminOnboardingsSearchParams, ...)` reads and writes - also what
 * `buildAdminOnboardingsQueryKey` takes, either directly or built fresh from a draft.
 */
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
