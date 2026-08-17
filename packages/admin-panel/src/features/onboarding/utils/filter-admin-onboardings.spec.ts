import { describe, expect, it } from 'vitest';
import { ADMIN_ONBOARDING_STATUSES } from '../types/admin-onboarding';
import {
  normalizeAdminOnboardingFilters,
  type AdminOnboardingFilters,
  WORKFLOW_VERSION_ERROR_MESSAGE,
} from './filter-admin-onboardings';

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
  it('normalizes blank and whitespace-only values by omitting all query keys', () => {
    const result = normalizeAdminOnboardingFilters({
      status: '',
      workflowId: '   ',
      workflowVersion: '\n\t',
      currentStep: ' ',
      onboardingId: '',
    });

    expect(result).toEqual({ ok: true, filters: {} });
  });

  it.each(ADMIN_ONBOARDING_STATUSES)('forwards the %s status as a query filter', (status) => {
    const result = normalizeAdminOnboardingFilters({ ...emptyFilters(), status });

    expect(result).toEqual({ ok: true, filters: { status } });
  });

  it('omits a status the engine does not define', () => {
    const result = normalizeAdminOnboardingFilters({
      ...emptyFilters(),
      status: 'not_a_status' as (typeof ADMIN_ONBOARDING_STATUSES)[number],
    });

    expect(result).toEqual({ ok: true, filters: {} });
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
        workflowVersion: '001',
      },
    });
  });
});
