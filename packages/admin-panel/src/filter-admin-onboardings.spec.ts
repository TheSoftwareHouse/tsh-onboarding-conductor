import { describe, expect, it } from 'vitest';
import { filterAdminOnboardings, type AdminOnboardingFilters } from './filter-admin-onboardings';
import type { AdminOnboardingSummary } from './types/admin-onboarding';

const RECORDS: AdminOnboardingSummary[] = [
  {
    onboardingId: '018f1e2a-1111-7000-8000-000000000001',
    workflowId: 'kyc-basic',
    workflowVersion: 1,
    status: 'awaiting_user',
    currentStep: 'collect-documents',
    expiresAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
    completedAt: null,
  },
  {
    onboardingId: '018F1E2A-2222-7000-8000-000000000002',
    workflowId: 'kyc-basic',
    workflowVersion: 2,
    status: 'approved',
    currentStep: null,
    expiresAt: null,
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-04T00:00:00.000Z',
    completedAt: '2026-07-05T00:00:00.000Z',
  },
  {
    onboardingId: '018f1e2a-3333-7000-8000-000000000003',
    workflowId: 'kyc-enhanced',
    workflowVersion: 1,
    status: 'awaiting_user',
    currentStep: 'collect-documents',
    expiresAt: '2026-08-02T00:00:00.000Z',
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    completedAt: null,
  },
];

function emptyFilters(): AdminOnboardingFilters {
  return {
    status: '',
    workflowId: '',
    workflowVersion: '',
    currentStep: '',
    onboardingId: '',
  };
}

describe('filterAdminOnboardings', () => {
  it('returns every record in source order when all criteria are blank', () => {
    const result = filterAdminOnboardings(RECORDS, emptyFilters());

    expect(result).toEqual({ records: RECORDS, workflowVersionInvalid: false });
  });

  it('filters by exact status equality', () => {
    const result = filterAdminOnboardings(RECORDS, { ...emptyFilters(), status: 'approved' });

    expect(result.records).toEqual([RECORDS[1]]);
    expect(result.workflowVersionInvalid).toBe(false);
  });

  it('filters by trimmed exact workflowId equality', () => {
    const result = filterAdminOnboardings(RECORDS, {
      ...emptyFilters(),
      workflowId: '  kyc-basic  ',
    });

    expect(result.records).toEqual([RECORDS[0], RECORDS[1]]);
  });

  it('filters by numeric workflowVersion equality', () => {
    const result = filterAdminOnboardings(RECORDS, { ...emptyFilters(), workflowVersion: '1' });

    expect(result.records).toEqual([RECORDS[0], RECORDS[2]]);
    expect(result.workflowVersionInvalid).toBe(false);
  });

  it('filters by exact currentStep equality and excludes null currentStep records', () => {
    const result = filterAdminOnboardings(RECORDS, {
      ...emptyFilters(),
      currentStep: 'collect-documents',
    });

    expect(result.records).toEqual([RECORDS[0], RECORDS[2]]);
  });

  it('filters by case-insensitive onboardingId equality', () => {
    const result = filterAdminOnboardings(RECORDS, {
      ...emptyFilters(),
      onboardingId: '018f1e2a-2222-7000-8000-000000000002',
    });

    expect(result.records).toEqual([RECORDS[1]]);
  });

  it('combines all five active filters with AND semantics', () => {
    const result = filterAdminOnboardings(RECORDS, {
      status: 'awaiting_user',
      workflowId: 'kyc-basic',
      workflowVersion: '1',
      currentStep: 'collect-documents',
      onboardingId: RECORDS[0].onboardingId,
    });

    expect(result.records).toEqual([RECORDS[0]]);
  });

  it('returns an empty result and preserves source order when no record matches', () => {
    const result = filterAdminOnboardings(RECORDS, { ...emptyFilters(), workflowId: 'unknown' });

    expect(result).toEqual({ records: [], workflowVersionInvalid: false });
  });

  it('flags a non-empty, non-integer workflowVersion as invalid and yields no matches', () => {
    const result = filterAdminOnboardings(RECORDS, {
      ...emptyFilters(),
      workflowVersion: 'not-a-number',
    });

    expect(result).toEqual({ records: [], workflowVersionInvalid: true });
  });

  it('flags a zero or negative workflowVersion as invalid', () => {
    const result = filterAdminOnboardings(RECORDS, { ...emptyFilters(), workflowVersion: '-1' });

    expect(result.workflowVersionInvalid).toBe(true);
    expect(result.records).toEqual([]);
  });

  it('treats whitespace-only criteria as disabled', () => {
    const result = filterAdminOnboardings(RECORDS, {
      status: '',
      workflowId: '   ',
      workflowVersion: '   ',
      currentStep: '   ',
      onboardingId: '   ',
    });

    expect(result).toEqual({ records: RECORDS, workflowVersionInvalid: false });
  });
});
