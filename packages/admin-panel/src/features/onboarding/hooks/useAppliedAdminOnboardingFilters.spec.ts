import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE } from '@/shared/lib/pagination';
import { useAppliedAdminOnboardingFilters } from './useAppliedAdminOnboardingFilters';
import { createDefaultAdminOnboardingFilters } from '../utils/admin-onboardings-query';
import type { AdminOnboardingFilters } from '../utils/filter-admin-onboardings';

/** The page window every query key carries, since the endpoint always paginates. */
const DEFAULT_WINDOW = { page: 1, limit: DEFAULT_PAGE_SIZE };

describe('useAppliedAdminOnboardingFilters', () => {
  it('starts with the default filters on the first page', () => {
    const { result } = renderHook(() => useAppliedAdminOnboardingFilters());

    expect(result.current.appliedFilters).toEqual(createDefaultAdminOnboardingFilters());
    expect(result.current.appliedPage).toBe(1);
    expect(result.current.queryKey).toEqual(['admin-onboardings', DEFAULT_WINDOW]);
  });

  it('commits trimmed filters and reports that the query key changed', () => {
    const { result } = renderHook(() => useAppliedAdminOnboardingFilters());
    const nextFilters: AdminOnboardingFilters = {
      ...createDefaultAdminOnboardingFilters(),
      workflowId: '  kyc-basic  ',
    };

    let commitResult: ReturnType<(typeof result)['current']['applyFilters']> | undefined;
    act(() => {
      commitResult = result.current.applyFilters(nextFilters);
    });

    expect(commitResult).toEqual({ didQueryKeyChange: true });
    expect(result.current.appliedFilters.workflowId).toBe('kyc-basic');
    expect(result.current.queryKey).toEqual([
      'admin-onboardings',
      { ...DEFAULT_WINDOW, workflowId: 'kyc-basic' },
    ]);
  });

  it('reports no query key change when re-applying the same committed filters', () => {
    const { result } = renderHook(() => useAppliedAdminOnboardingFilters());
    const filters: AdminOnboardingFilters = {
      ...createDefaultAdminOnboardingFilters(),
      workflowId: 'kyc-basic',
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
        ...createDefaultAdminOnboardingFilters(),
        workflowId: 'kyc-basic',
      });
    });

    let resetResult: ReturnType<(typeof result)['current']['resetFilters']> | undefined;
    act(() => {
      resetResult = result.current.resetFilters();
    });

    expect(resetResult).toEqual({ didQueryKeyChange: true });
    expect(result.current.appliedFilters).toEqual(createDefaultAdminOnboardingFilters());
    expect(result.current.appliedPage).toBe(1);
    expect(result.current.queryKey).toEqual(['admin-onboardings', DEFAULT_WINDOW]);
  });

  it('commits a new page against the already applied filters', () => {
    const { result } = renderHook(() => useAppliedAdminOnboardingFilters());

    act(() => {
      result.current.applyFilters({
        ...createDefaultAdminOnboardingFilters(),
        workflowId: 'kyc-basic',
      });
    });

    let commitResult: ReturnType<(typeof result)['current']['goToPage']> | undefined;
    act(() => {
      commitResult = result.current.goToPage(3);
    });

    expect(commitResult).toEqual({ didQueryKeyChange: true });
    expect(result.current.appliedPage).toBe(3);
    expect(result.current.appliedFilters.workflowId).toBe('kyc-basic');
    expect(result.current.queryKey).toEqual([
      'admin-onboardings',
      { ...DEFAULT_WINDOW, page: 3, workflowId: 'kyc-basic' },
    ]);
  });

  it('returns to the first page when new criteria are applied from a later page', () => {
    const { result } = renderHook(() => useAppliedAdminOnboardingFilters());

    act(() => {
      result.current.goToPage(4);
    });
    expect(result.current.appliedPage).toBe(4);

    act(() => {
      result.current.applyFilters({
        ...createDefaultAdminOnboardingFilters(),
        workflowId: 'kyc-basic',
      });
    });

    expect(result.current.appliedPage).toBe(1);
  });

  it('reports no query key change when re-committing the current page', () => {
    const { result } = renderHook(() => useAppliedAdminOnboardingFilters());

    act(() => {
      result.current.goToPage(2);
    });

    let commitResult: ReturnType<(typeof result)['current']['goToPage']> | undefined;
    act(() => {
      commitResult = result.current.goToPage(2);
    });

    expect(commitResult).toEqual({ didQueryKeyChange: false });
  });
});
