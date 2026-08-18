import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE } from '@/shared/lib/pagination';
import {
  areAdminOnboardingQueryFiltersEqual,
  buildAdminOnboardingsQueryKey,
  createDefaultAdminOnboardingFilters,
  createTrimmedAdminOnboardingFilters,
} from './admin-onboardings-query';
import type { AdminOnboardingFilters } from './filter-admin-onboardings';

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
      limit: 50,
    };

    expect(createTrimmedAdminOnboardingFilters(filters)).toEqual({
      status: '',
      workflowId: 'kyc-basic',
      workflowVersion: '7',
      currentStep: '',
      onboardingId: '',
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
      areAdminOnboardingQueryFiltersEqual(DEFAULT_WINDOW, { ...DEFAULT_WINDOW, limit: 100 }),
    ).toBe(false);
  });
});
