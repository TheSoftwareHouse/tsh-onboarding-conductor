import type { ReactElement, ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8';
import { BrowserRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import {
  useAppliedAdminOnboardingFilters,
  type UseAppliedAdminOnboardingFiltersResult,
} from './useAppliedAdminOnboardingFilters';
import {
  DEFAULT_ADMIN_ONBOARDING_FILTERS,
  type AdminOnboardingFilters,
} from '../utils/filter-admin-onboardings';

/** The committed state an all-absent URL normalizes to - every criterion `null`. */
const DEFAULT_WINDOW = {
  page: 1,
  limit: DEFAULT_PAGE_SIZE,
  status: null,
  workflowId: null,
  workflowVersion: null,
  currentStep: null,
  onboardingId: null,
};

interface Harness {
  applied: UseAppliedAdminOnboardingFiltersResult;
  /** Query string the router currently holds, which is where the committed filters live. */
  search: string;
}

function renderApplied(initialPath = '/onboardings'): { result: { current: Harness } } {
  // `BrowserRouter` reads and writes the same `window.history` the nuqs react-router adapter
  // does, matching production - so seeding is a single write before render.
  window.history.replaceState(null, '', initialPath);

  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <BrowserRouter>
      <NuqsAdapter>{children}</NuqsAdapter>
    </BrowserRouter>
  );

  return renderHook(
    (): Harness => ({
      applied: useAppliedAdminOnboardingFilters(),
      search: useLocation().search,
    }),
    { wrapper },
  );
}

afterEach(() => {
  // Unmounts every hook instance so it stops listening on nuqs's shared, module-level history
  // emitter - left mounted, a later test's URL commit could still reach it.
  cleanup();
});

describe('useAppliedAdminOnboardingFilters', () => {
  it('starts with the default filters on the first page', () => {
    const { result } = renderApplied();

    expect(result.current.applied.appliedFilters).toEqual(DEFAULT_ADMIN_ONBOARDING_FILTERS);
    expect(result.current.applied.appliedPage).toBe(1);
    expect(result.current.applied.appliedSearchValues).toEqual(DEFAULT_WINDOW);
  });

  it('starts from the criteria the URL carries, so a filtered list survives leaving the section', () => {
    const { result } = renderApplied('/onboardings?status=approved&workflowId=kyc-basic&page=3');

    expect(result.current.applied.appliedFilters).toEqual({
      ...DEFAULT_ADMIN_ONBOARDING_FILTERS,
      status: 'approved',
      workflowId: 'kyc-basic',
    });
    expect(result.current.applied.appliedPage).toBe(3);
    expect(result.current.applied.appliedSearchValues).toEqual({
      ...DEFAULT_WINDOW,
      page: 3,
      status: 'approved',
      workflowId: 'kyc-basic',
    });
  });

  it('ignores criteria the panel could not have committed itself', () => {
    const { result } = renderApplied('/onboardings?status=not-a-status&limit=7&page=0');

    expect(result.current.applied.appliedFilters).toEqual(DEFAULT_ADMIN_ONBOARDING_FILTERS);
    expect(result.current.applied.appliedPage).toBe(1);
  });

  it('falls a badly stated workflowVersion back to its default while keeping every other criterion', () => {
    const { result } = renderApplied('/onboardings?workflowId=kyc-basic&workflowVersion=one');

    expect(result.current.applied.appliedFilters).toEqual({
      ...DEFAULT_ADMIN_ONBOARDING_FILTERS,
      workflowId: 'kyc-basic',
    });
  });

  it('applies status and workflowId while falling a malformed workflowVersion back to its default, and keeps both in the committed state', () => {
    const { result } = renderApplied(
      '/onboardings?workflowId=kyc-basic&status=approved&workflowVersion=abc',
    );

    expect(result.current.applied.appliedFilters).toEqual({
      ...DEFAULT_ADMIN_ONBOARDING_FILTERS,
      status: 'approved',
      workflowId: 'kyc-basic',
    });
    // Every criterion that was valid on its own survives; the malformed one alone falls back.
    expect(result.current.applied.appliedSearchValues).toEqual({
      ...DEFAULT_WINDOW,
      status: 'approved',
      workflowId: 'kyc-basic',
    });
  });

  it('commits trimmed filters', () => {
    const { result } = renderApplied();
    const nextFilters: AdminOnboardingFilters = {
      ...DEFAULT_ADMIN_ONBOARDING_FILTERS,
      workflowId: '  kyc-basic  ',
    };

    act(() => {
      result.current.applied.applyFilters(nextFilters);
    });

    expect(result.current.applied.appliedFilters.workflowId).toBe('kyc-basic');
    expect(result.current.applied.appliedSearchValues).toEqual({
      ...DEFAULT_WINDOW,
      workflowId: 'kyc-basic',
    });
  });

  it('writes the committed criteria into the URL, leaving out the blank ones and the default window', async () => {
    const { result } = renderApplied();

    act(() => {
      result.current.applied.applyFilters({
        ...DEFAULT_ADMIN_ONBOARDING_FILTERS,
        status: 'rejected',
        workflowId: 'kyc-basic',
      });
    });

    // The URL write is throttled by nuqs, so it lands a tick after the commit that queued it.
    await waitFor(() => {
      expect(result.current.search).toBe('?status=rejected&workflowId=kyc-basic');
    });

    act(() => {
      result.current.applied.goToPage(2);
    });

    await waitFor(() => {
      expect(result.current.search).toBe('?status=rejected&workflowId=kyc-basic&page=2');
    });
  });

  it('resets to the default filters', () => {
    const { result } = renderApplied();

    act(() => {
      result.current.applied.applyFilters({
        ...DEFAULT_ADMIN_ONBOARDING_FILTERS,
        workflowId: 'kyc-basic',
      });
    });

    act(() => {
      result.current.applied.resetFilters();
    });

    expect(result.current.applied.appliedFilters).toEqual(DEFAULT_ADMIN_ONBOARDING_FILTERS);
    expect(result.current.applied.appliedPage).toBe(1);
    expect(result.current.applied.appliedSearchValues).toEqual(DEFAULT_WINDOW);
    expect(result.current.search).toBe('');
  });

  it('commits a new page against the already applied filters', () => {
    const { result } = renderApplied();

    act(() => {
      result.current.applied.applyFilters({
        ...DEFAULT_ADMIN_ONBOARDING_FILTERS,
        workflowId: 'kyc-basic',
      });
    });

    act(() => {
      result.current.applied.goToPage(3);
    });

    expect(result.current.applied.appliedPage).toBe(3);
    expect(result.current.applied.appliedFilters.workflowId).toBe('kyc-basic');
    expect(result.current.applied.appliedSearchValues).toEqual({
      ...DEFAULT_WINDOW,
      page: 3,
      workflowId: 'kyc-basic',
    });
  });

  it('returns to the first page when new criteria are applied from a later page', () => {
    const { result } = renderApplied();

    act(() => {
      result.current.applied.goToPage(4);
    });
    expect(result.current.applied.appliedPage).toBe(4);

    act(() => {
      result.current.applied.applyFilters({
        ...DEFAULT_ADMIN_ONBOARDING_FILTERS,
        workflowId: 'kyc-basic',
      });
    });

    expect(result.current.applied.appliedPage).toBe(1);
  });
});
