import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE } from '@/shared/lib/pagination';
import { ADMIN_ONBOARDING_STATUSES } from '../types/admin-onboarding';
import {
  normalizeAdminOnboardingFilters,
  type AdminOnboardingFilters,
  SCORE_ERROR_MESSAGE,
  WORKFLOW_VERSION_ERROR_MESSAGE,
} from './filter-admin-onboardings';
import { createDefaultAdminOnboardingFilters } from './admin-onboardings-query';
import {
  DEFAULT_ADMIN_ONBOARDING_SORT_DIRECTION,
  DEFAULT_ADMIN_ONBOARDING_SORT_FIELD,
} from './filter-admin-onboardings';

function emptyFilters(): AdminOnboardingFilters {
  return {
    status: '',
    workflowId: '',
    workflowVersion: '',
    currentStep: '',
    onboardingId: '',
    minScore: '',
    maxScore: '',
    sortBy: DEFAULT_ADMIN_ONBOARDING_SORT_FIELD,
    sortDir: DEFAULT_ADMIN_ONBOARDING_SORT_DIRECTION,
    limit: DEFAULT_PAGE_SIZE,
  };
}

/** The page window every normalized query carries, since the endpoint always paginates. */
const DEFAULT_WINDOW = { page: 1, limit: DEFAULT_PAGE_SIZE };

describe('filterAdminOnboardings', () => {
  it('normalizes blank and whitespace-only values by omitting all query keys', () => {
    const result = normalizeAdminOnboardingFilters({
      status: '',
      workflowId: '   ',
      workflowVersion: '\n\t',
      currentStep: ' ',
      onboardingId: '',
      minScore: '',
      maxScore: '',
      sortBy: DEFAULT_ADMIN_ONBOARDING_SORT_FIELD,
      sortDir: DEFAULT_ADMIN_ONBOARDING_SORT_DIRECTION,
      limit: DEFAULT_PAGE_SIZE,
    });

    expect(result).toEqual({ ok: true, filters: DEFAULT_WINDOW });
  });

  it.each(ADMIN_ONBOARDING_STATUSES)('forwards the %s status as a query filter', (status) => {
    const result = normalizeAdminOnboardingFilters({ ...emptyFilters(), status });

    expect(result).toEqual({ ok: true, filters: { ...DEFAULT_WINDOW, status } });
  });

  it('omits a status the engine does not define', () => {
    const result = normalizeAdminOnboardingFilters({
      ...emptyFilters(),
      status: 'not_a_status' as (typeof ADMIN_ONBOARDING_STATUSES)[number],
    });

    expect(result).toEqual({ ok: true, filters: DEFAULT_WINDOW });
  });

  it('trims supported text values', () => {
    const result = normalizeAdminOnboardingFilters({
      ...emptyFilters(),
      workflowId: '  kyc-basic  ',
      workflowVersion: '  7 ',
      currentStep: ' collect-documents ',
      onboardingId: ' 018f1e2a-1111-7000-8000-000000000001 ',
    });

    expect(result).toEqual({
      ok: true,
      filters: {
        ...DEFAULT_WINDOW,
        workflowId: 'kyc-basic',
        workflowVersion: '7',
        currentStep: 'collect-documents',
        onboardingId: '018f1e2a-1111-7000-8000-000000000001',
      },
    });
  });

  it('rejects non-empty invalid workflowVersion values', () => {
    const invalidCases = ['0', '-1', '+1', '1.2', '1e3', 'abc'];

    for (const workflowVersion of invalidCases) {
      const result = normalizeAdminOnboardingFilters({
        ...emptyFilters(),
        workflowVersion,
      });

      expect(result).toEqual({
        ok: false,
        error: {
          reason: 'invalid-workflow-version',
          message: WORKFLOW_VERSION_ERROR_MESSAGE,
        },
      });
    }
  });

  it('accepts non-empty positive base-10 workflowVersion values', () => {
    const result = normalizeAdminOnboardingFilters({
      ...emptyFilters(),
      workflowVersion: '001',
    });

    expect(result).toEqual({
      ok: true,
      filters: {
        ...DEFAULT_WINDOW,
        workflowVersion: '001',
      },
    });
  });

  it('sends the page it was asked for and the selected page size', () => {
    const result = normalizeAdminOnboardingFilters({ ...emptyFilters(), limit: 50 }, 4);

    expect(result).toEqual({ ok: true, filters: { page: 4, limit: 50 } });
  });

  it('refuses an invalid workflowVersion without reporting a page window', () => {
    const result = normalizeAdminOnboardingFilters(
      { ...emptyFilters(), workflowVersion: 'abc' },
      3,
    );

    expect(result.ok).toBe(false);
  });
});

describe('normalizeAdminOnboardingFilters score criteria', () => {
  const filters = (overrides: Partial<AdminOnboardingFilters> = {}): AdminOnboardingFilters => ({
    ...createDefaultAdminOnboardingFilters(),
    ...overrides,
  });

  it('passes whole-number bounds through as stated', () => {
    const result = normalizeAdminOnboardingFilters(filters({ minScore: '40', maxScore: '80' }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filters.minScore).toBe('40');
      expect(result.filters.maxScore).toBe('80');
    }
  });

  it('accepts a negative bound, because a score may fall below zero', () => {
    const result = normalizeAdminOnboardingFilters(filters({ minScore: '-30' }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filters.minScore).toBe('-30');
    }
  });

  it('omits a blank bound rather than sending an empty value', () => {
    const result = normalizeAdminOnboardingFilters(filters({ minScore: '  ', maxScore: '' }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filters.minScore).toBeUndefined();
      expect(result.filters.maxScore).toBeUndefined();
    }
  });

  it('refuses a bound that is not a whole number, naming which one', () => {
    expect(normalizeAdminOnboardingFilters(filters({ minScore: 'abc' }))).toEqual({
      ok: false,
      error: { reason: 'invalid-min-score', message: SCORE_ERROR_MESSAGE },
    });
    expect(normalizeAdminOnboardingFilters(filters({ maxScore: '12.5' }))).toEqual({
      ok: false,
      error: { reason: 'invalid-max-score', message: SCORE_ERROR_MESSAGE },
    });
  });

  it('states the ordering only when it differs from what the endpoint already does', () => {
    const untouched = normalizeAdminOnboardingFilters(filters());
    expect(untouched.ok && untouched.filters.sortBy).toBeUndefined();
    expect(untouched.ok && untouched.filters.sortDir).toBeUndefined();

    const sorted = normalizeAdminOnboardingFilters(filters({ sortBy: 'score', sortDir: 'asc' }));
    expect(sorted.ok && sorted.filters.sortBy).toBe('score');
    expect(sorted.ok && sorted.filters.sortDir).toBe('asc');
  });
});
