import type { ReactElement, ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import {
  useAppliedAdminOnboardingFilters,
  type UseAppliedAdminOnboardingFiltersResult,
} from './useAppliedAdminOnboardingFilters';
import { createDefaultAdminOnboardingFilters } from '../utils/admin-onboardings-query';
import type { AdminOnboardingFilters } from '../utils/filter-admin-onboardings';

/** The page window every query key carries, since the endpoint always paginates. */
const DEFAULT_WINDOW = { page: 1, limit: DEFAULT_PAGE_SIZE };

interface Harness {
  applied: UseAppliedAdminOnboardingFiltersResult;
  /** Query string the router currently holds, which is where the committed filters live. */
  search: string;
}

function renderApplied(initialPath = '/onboardings'): { result: { current: Harness } } {
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
  );

  return renderHook(
    (): Harness => ({
      applied: useAppliedAdminOnboardingFilters(),
      search: useLocation().search,
    }),
    { wrapper },
  );
}

describe('useAppliedAdminOnboardingFilters', () => {
  it('starts with the default filters on the first page', () => {
    const { result } = renderApplied();

    expect(result.current.applied.appliedFilters).toEqual(createDefaultAdminOnboardingFilters());
    expect(result.current.applied.appliedPage).toBe(1);
    expect(result.current.applied.queryKey).toEqual(['admin-onboardings', DEFAULT_WINDOW]);
  });

  it('starts from the criteria the URL carries, so a filtered list survives leaving the section', () => {
    const { result } = renderApplied('/onboardings?status=approved&workflowId=kyc-basic&page=3');

    expect(result.current.applied.appliedFilters).toEqual({
      ...createDefaultAdminOnboardingFilters(),
      status: 'approved',
      workflowId: 'kyc-basic',
    });
    expect(result.current.applied.appliedPage).toBe(3);
    expect(result.current.applied.queryKey).toEqual([
      'admin-onboardings',
      { ...DEFAULT_WINDOW, page: 3, status: 'approved', workflowId: 'kyc-basic' },
    ]);
  });

  it('ignores criteria the panel could not have committed itself', () => {
    const { result } = renderApplied('/onboardings?status=not-a-status&limit=7&page=0');

    expect(result.current.applied.appliedFilters).toEqual(createDefaultAdminOnboardingFilters());
    expect(result.current.applied.appliedPage).toBe(1);
  });

  it('drops a filter set the endpoint would refuse rather than honoring it in part', () => {
    const { result } = renderApplied('/onboardings?workflowId=kyc-basic&workflowVersion=one');

    expect(result.current.applied.appliedFilters).toEqual(createDefaultAdminOnboardingFilters());
  });

  it('commits trimmed filters and reports that the query key changed', () => {
    const { result } = renderApplied();
    const nextFilters: AdminOnboardingFilters = {
      ...createDefaultAdminOnboardingFilters(),
      workflowId: '  kyc-basic  ',
    };

    let commitResult: ReturnType<Harness['applied']['applyFilters']> | undefined;
    act(() => {
      commitResult = result.current.applied.applyFilters(nextFilters);
    });

    expect(commitResult).toEqual({ didQueryKeyChange: true });
    expect(result.current.applied.appliedFilters.workflowId).toBe('kyc-basic');
    expect(result.current.applied.queryKey).toEqual([
      'admin-onboardings',
      { ...DEFAULT_WINDOW, workflowId: 'kyc-basic' },
    ]);
  });

  it('writes the committed criteria into the URL, leaving out the blank ones and the default window', () => {
    const { result } = renderApplied();

    act(() => {
      result.current.applied.applyFilters({
        ...createDefaultAdminOnboardingFilters(),
        status: 'rejected',
        workflowId: 'kyc-basic',
      });
    });

    expect(result.current.search).toBe('?status=rejected&workflowId=kyc-basic');

    act(() => {
      result.current.applied.goToPage(2);
    });

    expect(result.current.search).toBe('?status=rejected&workflowId=kyc-basic&page=2');
  });

  it('reports no query key change when re-applying the same committed filters', () => {
    const { result } = renderApplied();
    const filters: AdminOnboardingFilters = {
      ...createDefaultAdminOnboardingFilters(),
      workflowId: 'kyc-basic',
    };

    act(() => {
      result.current.applied.applyFilters(filters);
    });

    let commitResult: ReturnType<Harness['applied']['applyFilters']> | undefined;
    act(() => {
      commitResult = result.current.applied.applyFilters({ ...filters });
    });

    expect(commitResult).toEqual({ didQueryKeyChange: false });
  });

  it('resets to the default filters and reports the query key change', () => {
    const { result } = renderApplied();

    act(() => {
      result.current.applied.applyFilters({
        ...createDefaultAdminOnboardingFilters(),
        workflowId: 'kyc-basic',
      });
    });

    let resetResult: ReturnType<Harness['applied']['resetFilters']> | undefined;
    act(() => {
      resetResult = result.current.applied.resetFilters();
    });

    expect(resetResult).toEqual({ didQueryKeyChange: true });
    expect(result.current.applied.appliedFilters).toEqual(createDefaultAdminOnboardingFilters());
    expect(result.current.applied.appliedPage).toBe(1);
    expect(result.current.applied.queryKey).toEqual(['admin-onboardings', DEFAULT_WINDOW]);
    expect(result.current.search).toBe('');
  });

  it('commits a new page against the already applied filters', () => {
    const { result } = renderApplied();

    act(() => {
      result.current.applied.applyFilters({
        ...createDefaultAdminOnboardingFilters(),
        workflowId: 'kyc-basic',
      });
    });

    let commitResult: ReturnType<Harness['applied']['goToPage']> | undefined;
    act(() => {
      commitResult = result.current.applied.goToPage(3);
    });

    expect(commitResult).toEqual({ didQueryKeyChange: true });
    expect(result.current.applied.appliedPage).toBe(3);
    expect(result.current.applied.appliedFilters.workflowId).toBe('kyc-basic');
    expect(result.current.applied.queryKey).toEqual([
      'admin-onboardings',
      { ...DEFAULT_WINDOW, page: 3, workflowId: 'kyc-basic' },
    ]);
  });

  it('returns to the first page when new criteria are applied from a later page', () => {
    const { result } = renderApplied();

    act(() => {
      result.current.applied.goToPage(4);
    });
    expect(result.current.applied.appliedPage).toBe(4);

    act(() => {
      result.current.applied.applyFilters({
        ...createDefaultAdminOnboardingFilters(),
        workflowId: 'kyc-basic',
      });
    });

    expect(result.current.applied.appliedPage).toBe(1);
  });

  it('reports no query key change when re-committing the current page', () => {
    const { result } = renderApplied();

    act(() => {
      result.current.applied.goToPage(2);
    });

    let commitResult: ReturnType<Harness['applied']['goToPage']> | undefined;
    act(() => {
      commitResult = result.current.applied.goToPage(2);
    });

    expect(commitResult).toEqual({ didQueryKeyChange: false });
  });
});
