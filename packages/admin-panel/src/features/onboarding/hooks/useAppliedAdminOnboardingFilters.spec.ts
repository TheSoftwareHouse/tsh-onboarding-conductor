import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAppliedAdminOnboardingFilters } from './useAppliedAdminOnboardingFilters';
import { createDefaultAdminOnboardingFilters } from '../utils/admin-onboardings-query';
import type { AdminOnboardingFilters } from '../utils/filter-admin-onboardings';

describe('useAppliedAdminOnboardingFilters', () => {
  it('starts with the default filters and the unfiltered query key', () => {
    const { result } = renderHook(() => useAppliedAdminOnboardingFilters());

    expect(result.current.appliedFilters).toEqual(createDefaultAdminOnboardingFilters());
    expect(result.current.queryKey).toEqual(['admin-onboardings', {}]);
  });

  it('commits trimmed filters and reports that the query key changed', () => {
    const { result } = renderHook(() => useAppliedAdminOnboardingFilters());
    const nextFilters: AdminOnboardingFilters = {
      status: '',
      workflowId: '  kyc-basic  ',
      workflowVersion: '',
      currentStep: '',
      onboardingId: '',
    };

    let commitResult: ReturnType<(typeof result)['current']['applyFilters']> | undefined;
    act(() => {
      commitResult = result.current.applyFilters(nextFilters);
    });

    expect(commitResult).toEqual({ didQueryKeyChange: true });
    expect(result.current.appliedFilters.workflowId).toBe('kyc-basic');
    expect(result.current.queryKey).toEqual(['admin-onboardings', { workflowId: 'kyc-basic' }]);
  });

  it('reports no query key change when re-applying the same committed filters', () => {
    const { result } = renderHook(() => useAppliedAdminOnboardingFilters());
    const filters: AdminOnboardingFilters = {
      status: '',
      workflowId: 'kyc-basic',
      workflowVersion: '',
      currentStep: '',
      onboardingId: '',
    };

    act(() => {
      result.current.applyFilters(filters);
    });

    let commitResult: ReturnType<(typeof result)['current']['applyFilters']> | undefined;
    act(() => {
      commitResult = result.current.applyFilters({ ...filters });
    });

    expect(commitResult).toEqual({ didQueryKeyChange: false });
  });

  it('resets to the default filters and reports the query key change', () => {
    const { result } = renderHook(() => useAppliedAdminOnboardingFilters());

    act(() => {
      result.current.applyFilters({
        status: '',
        workflowId: 'kyc-basic',
        workflowVersion: '',
        currentStep: '',
        onboardingId: '',
      });
    });

    let resetResult: ReturnType<(typeof result)['current']['resetFilters']> | undefined;
    act(() => {
      resetResult = result.current.resetFilters();
    });

    expect(resetResult).toEqual({ didQueryKeyChange: true });
    expect(result.current.appliedFilters).toEqual(createDefaultAdminOnboardingFilters());
    expect(result.current.queryKey).toEqual(['admin-onboardings', {}]);
  });
});
