import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { ADMIN_ONBOARDING_STATUSES } from '../types/admin-onboarding';
import {
  ADMIN_ONBOARDINGS_QUERY_KEY_PREFIX,
  buildAdminOnboardingsQueryKey,
  DEFAULT_ADMIN_ONBOARDING_FILTERS,
} from './admin-onboardings-query';
import type { AdminOnboardingsSearchValues } from './admin-onboardings-search-params';

function emptyState(): AdminOnboardingsSearchValues {
  return {
    status: null,
    workflowId: null,
    workflowVersion: null,
    currentStep: null,
    onboardingId: null,
    page: DEFAULT_PAGE,
    limit: DEFAULT_PAGE_SIZE,
  };
}

/** The query filters an all-absent state projects to - every criterion `null`. */
const DEFAULT_WINDOW = {
  page: DEFAULT_PAGE,
  limit: DEFAULT_PAGE_SIZE,
  status: null,
  workflowId: null,
  workflowVersion: null,
  currentStep: null,
  onboardingId: null,
};

/** The key's filters, which is where this module's projection ends up. */
function queryFilters(state: AdminOnboardingsSearchValues) {
  return buildAdminOnboardingsQueryKey(state)[1];
}

describe('DEFAULT_ADMIN_ONBOARDING_FILTERS', () => {
  it('returns all-blank draft filters at the default page size', () => {
    expect(DEFAULT_ADMIN_ONBOARDING_FILTERS).toEqual({
      status: '',
      workflowId: '',
      workflowVersion: '',
      currentStep: '',
      onboardingId: '',
      limit: DEFAULT_PAGE_SIZE,
    });
  });

  it('is frozen, since every consumer shares the one object', () => {
    expect(Object.isFrozen(DEFAULT_ADMIN_ONBOARDING_FILTERS)).toBe(true);
  });
});

describe('buildAdminOnboardingsQueryKey', () => {
  it('prefixes the key with the query key prefix', () => {
    const [prefix] = buildAdminOnboardingsQueryKey(emptyState());

    expect(prefix).toBe(ADMIN_ONBOARDINGS_QUERY_KEY_PREFIX);
  });

  it('maps an all-absent state to a query with every criterion null', () => {
    expect(queryFilters(emptyState())).toEqual(DEFAULT_WINDOW);
  });

  it.each(ADMIN_ONBOARDING_STATUSES)('forwards the %s status as a query filter', (status) => {
    expect(queryFilters({ ...emptyState(), status })).toEqual({ ...DEFAULT_WINDOW, status });
  });

  it('forwards already-trimmed text values as-is, without trimming again', () => {
    const state = {
      ...emptyState(),
      workflowId: 'kyc-basic',
      workflowVersion: '7',
      currentStep: 'collect-documents',
      onboardingId: '018f1e2a-1111-7000-8000-000000000001',
    };

    expect(queryFilters(state)).toEqual({
      ...DEFAULT_WINDOW,
      workflowId: 'kyc-basic',
      workflowVersion: '7',
      currentStep: 'collect-documents',
      onboardingId: '018f1e2a-1111-7000-8000-000000000001',
    });
  });

  it('carries a workflowVersion through exactly as the URL stated it', () => {
    expect(queryFilters({ ...emptyState(), workflowVersion: '001' })).toEqual({
      ...DEFAULT_WINDOW,
      workflowVersion: '001',
    });
  });

  it("sends the state's own page and page size, the only place either is stated", () => {
    expect(queryFilters({ ...emptyState(), page: 3, limit: 50 })).toEqual({
      ...DEFAULT_WINDOW,
      page: 3,
      limit: 50,
    });
  });
});
