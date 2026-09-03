import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE } from '@/shared/lib/pagination';
import {
  areAdminOnboardingQueryFiltersEqual,
  buildAdminOnboardingsQueryKey,
  createDefaultAdminOnboardingFilters,
  createTrimmedAdminOnboardingFilters,
} from './admin-onboardings-query';
import {
  buildAdminOnboardingsSearchParams,
  readAdminOnboardingFilters,
} from './admin-onboardings-search-params';
import type { AdminOnboardingFilters } from './filter-admin-onboardings';
import {
  DEFAULT_ADMIN_ONBOARDING_SORT_DIRECTION,
  DEFAULT_ADMIN_ONBOARDING_SORT_FIELD,
} from './filter-admin-onboardings';

/** The page window every query key carries, since the endpoint always paginates. */
const DEFAULT_WINDOW = { page: 1, limit: DEFAULT_PAGE_SIZE };

describe('createDefaultAdminOnboardingFilters', () => {
  it('returns all-blank draft filters at the default page size', () => {
    expect(createDefaultAdminOnboardingFilters()).toEqual({
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
    });
  });

  it('returns a fresh object on each call', () => {
    expect(createDefaultAdminOnboardingFilters()).not.toBe(createDefaultAdminOnboardingFilters());
  });
});

describe('createTrimmedAdminOnboardingFilters', () => {
  it('trims whitespace but keeps blank values as empty strings', () => {
    const filters: AdminOnboardingFilters = {
      status: '',
      workflowId: '  kyc-basic  ',
      workflowVersion: '  7 ',
      currentStep: '  ',
      onboardingId: '',
      minScore: '',
      maxScore: '',
      sortBy: DEFAULT_ADMIN_ONBOARDING_SORT_FIELD,
      sortDir: DEFAULT_ADMIN_ONBOARDING_SORT_DIRECTION,
      limit: 50,
    };

    expect(createTrimmedAdminOnboardingFilters(filters)).toEqual({
      status: '',
      workflowId: 'kyc-basic',
      workflowVersion: '7',
      currentStep: '',
      onboardingId: '',
      minScore: '',
      maxScore: '',
      sortBy: DEFAULT_ADMIN_ONBOARDING_SORT_FIELD,
      sortDir: DEFAULT_ADMIN_ONBOARDING_SORT_DIRECTION,
      limit: 50,
    });
  });
});

describe('buildAdminOnboardingsQueryKey', () => {
  it('builds the first-page unfiltered key when all filters are blank', () => {
    expect(buildAdminOnboardingsQueryKey(createDefaultAdminOnboardingFilters())).toEqual([
      'admin-onboardings',
      DEFAULT_WINDOW,
    ]);
  });

  it('builds a key containing only the supported, validated filters', () => {
    const key = buildAdminOnboardingsQueryKey({
      status: 'approved',
      workflowId: 'kyc-basic',
      workflowVersion: '3',
      currentStep: '',
      onboardingId: '',
      minScore: '',
      maxScore: '',
      sortBy: DEFAULT_ADMIN_ONBOARDING_SORT_FIELD,
      sortDir: DEFAULT_ADMIN_ONBOARDING_SORT_DIRECTION,
      limit: DEFAULT_PAGE_SIZE,
    });

    expect(key).toEqual([
      'admin-onboardings',
      { ...DEFAULT_WINDOW, status: 'approved', workflowId: 'kyc-basic', workflowVersion: '3' },
    ]);
  });

  it('carries the requested page and page size into the key', () => {
    const key = buildAdminOnboardingsQueryKey(
      { ...createDefaultAdminOnboardingFilters(), limit: 100 },
      5,
    );

    expect(key).toEqual(['admin-onboardings', { page: 5, limit: 100 }]);
  });

  it('collapses an invalid workflowVersion to the unfiltered first-page key', () => {
    const key = buildAdminOnboardingsQueryKey({
      status: '',
      workflowId: '',
      workflowVersion: 'not-a-number',
      currentStep: '',
      onboardingId: '',
      minScore: '',
      maxScore: '',
      sortBy: DEFAULT_ADMIN_ONBOARDING_SORT_FIELD,
      sortDir: DEFAULT_ADMIN_ONBOARDING_SORT_DIRECTION,
      limit: DEFAULT_PAGE_SIZE,
    });

    expect(key).toEqual(['admin-onboardings', DEFAULT_WINDOW]);
  });
});

describe('areAdminOnboardingQueryFiltersEqual', () => {
  it('returns true for structurally identical filter objects', () => {
    expect(
      areAdminOnboardingQueryFiltersEqual(
        { ...DEFAULT_WINDOW, status: 'approved', workflowId: 'kyc-basic' },
        { ...DEFAULT_WINDOW, status: 'approved', workflowId: 'kyc-basic' },
      ),
    ).toBe(true);
  });

  it('returns false when any supported field differs', () => {
    expect(
      areAdminOnboardingQueryFiltersEqual(
        { ...DEFAULT_WINDOW, workflowId: 'kyc-basic' },
        { ...DEFAULT_WINDOW, workflowId: 'kyc-advanced' },
      ),
    ).toBe(false);
  });

  it('returns false when only the page differs, so moving page refetches', () => {
    expect(
      areAdminOnboardingQueryFiltersEqual(DEFAULT_WINDOW, { ...DEFAULT_WINDOW, page: 2 }),
    ).toBe(false);
  });

  it('returns false when only the page size differs', () => {
    expect(
      areAdminOnboardingQueryFiltersEqual(DEFAULT_WINDOW, { ...DEFAULT_WINDOW, limit: 50 }),
    ).toBe(false);
  });
});

describe('score criteria in the query key and the URL', () => {
  const withScore = (overrides: Partial<AdminOnboardingFilters> = {}): AdminOnboardingFilters => ({
    ...createDefaultAdminOnboardingFilters(),
    ...overrides,
  });

  it('carries the score bounds and the ordering into the query key', () => {
    const [, filters] = buildAdminOnboardingsQueryKey(
      withScore({ minScore: '40', maxScore: '80', sortBy: 'score', sortDir: 'asc' }),
    );

    expect(filters).toMatchObject({
      minScore: '40',
      maxScore: '80',
      sortBy: 'score',
      sortDir: 'asc',
    });
  });

  it('survives a URL round-trip, ordering included', () => {
    const original = withScore({
      minScore: '-30',
      maxScore: '80',
      sortBy: 'score',
      sortDir: 'asc',
    });

    const params = buildAdminOnboardingsSearchParams(original, 1);
    const restored = readAdminOnboardingFilters(params);

    expect(restored.minScore).toBe('-30');
    expect(restored.maxScore).toBe('80');
    expect(restored.sortBy).toBe('score');
    expect(restored.sortDir).toBe('asc');
  });

  it('leaves the default ordering out of the URL entirely', () => {
    const params = buildAdminOnboardingsSearchParams(createDefaultAdminOnboardingFilters(), 1);

    expect(params.has('sortBy')).toBe(false);
    expect(params.has('sortDir')).toBe(false);
    expect(params.has('minScore')).toBe(false);
  });

  it('falls back to the default ordering when the URL names one it does not know', () => {
    const params = new URLSearchParams({ sortBy: 'context', sortDir: 'sideways' });

    const restored = readAdminOnboardingFilters(params);

    expect(restored.sortBy).toBe(DEFAULT_ADMIN_ONBOARDING_SORT_FIELD);
    expect(restored.sortDir).toBe(DEFAULT_ADMIN_ONBOARDING_SORT_DIRECTION);
  });
});
