import { describe, expect, it } from 'vitest';
import {
  areAdminOnboardingQueryFiltersEqual,
  buildAdminOnboardingsQueryKey,
  createDefaultAdminOnboardingFilters,
  createTrimmedAdminOnboardingFilters,
} from './admin-onboardings-query';
import type { AdminOnboardingFilters } from './filter-admin-onboardings';

describe('createDefaultAdminOnboardingFilters', () => {
  it('returns all-blank draft filters', () => {
    expect(createDefaultAdminOnboardingFilters()).toEqual({
      status: '',
      workflowId: '',
      workflowVersion: '',
      currentStep: '',
      onboardingId: '',
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
    };

    expect(createTrimmedAdminOnboardingFilters(filters)).toEqual({
      status: '',
      workflowId: 'kyc-basic',
      workflowVersion: '7',
      currentStep: '',
      onboardingId: '',
    });
  });
});

describe('buildAdminOnboardingsQueryKey', () => {
  it('builds the unfiltered key when all filters are blank', () => {
    expect(buildAdminOnboardingsQueryKey(createDefaultAdminOnboardingFilters())).toEqual([
      'admin-onboardings',
      {},
    ]);
  });

  it('builds a key containing only the supported, validated filters', () => {
    const key = buildAdminOnboardingsQueryKey({
      status: 'approved',
      workflowId: 'kyc-basic',
      workflowVersion: '3',
      currentStep: '',
      onboardingId: '',
    });

    expect(key).toEqual([
      'admin-onboardings',
      { status: 'approved', workflowId: 'kyc-basic', workflowVersion: '3' },
    ]);
  });

  it('collapses an invalid workflowVersion to the unfiltered key', () => {
    const key = buildAdminOnboardingsQueryKey({
      status: '',
      workflowId: '',
      workflowVersion: 'not-a-number',
      currentStep: '',
      onboardingId: '',
    });

    expect(key).toEqual(['admin-onboardings', {}]);
  });
});

describe('areAdminOnboardingQueryFiltersEqual', () => {
  it('returns true for structurally identical filter objects', () => {
    expect(
      areAdminOnboardingQueryFiltersEqual(
        { status: 'approved', workflowId: 'kyc-basic' },
        { status: 'approved', workflowId: 'kyc-basic' },
      ),
    ).toBe(true);
  });

  it('returns false when any supported field differs', () => {
    expect(
      areAdminOnboardingQueryFiltersEqual(
        { workflowId: 'kyc-basic' },
        { workflowId: 'kyc-advanced' },
      ),
    ).toBe(false);
  });
});
