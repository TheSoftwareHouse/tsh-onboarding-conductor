import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAdminOnboardings, type AdminOnboardingsFetchError } from '../api/admin-onboardings';
import type { AdminOnboardingFilters } from './filter-admin-onboardings';
import type { AdminOnboardingSummary } from './admin-onboarding';

export type AdminOnboardingsPhase = 'loading' | 'error' | 'ready';

export interface UseAdminOnboardingsResult {
  phase: AdminOnboardingsPhase;
  records: AdminOnboardingSummary[];
  error: AdminOnboardingsFetchError | null;
  appliedFilters: AdminOnboardingFilters;
  applyFilters: (filters: AdminOnboardingFilters) => void;
  reload: () => void;
  resetFilters: () => void;
}

function createDefaultFilters(): AdminOnboardingFilters {
  return {
    status: '',
    workflowId: '',
    workflowVersion: '',
    currentStep: '',
    onboardingId: '',
  };
}

/**
 * Owns the admin onboardings request lifecycle: loads once on mount, guards against
 * a duplicate in-flight request (e.g. React StrictMode's double effect invocation),
 * and exposes an explicit reload action that repeats the same unfiltered request.
 */
export function useAdminOnboardings(): UseAdminOnboardingsResult {
  const [phase, setPhase] = useState<AdminOnboardingsPhase>('loading');
  const [records, setRecords] = useState<AdminOnboardingSummary[]>([]);
  const [error, setError] = useState<AdminOnboardingsFetchError | null>(null);
  const [appliedFilters, setAppliedFilters] =
    useState<AdminOnboardingFilters>(createDefaultFilters);
  const requestInFlightRef = useRef(false);

  const load = useCallback(async (filters: AdminOnboardingFilters): Promise<void> => {
    if (requestInFlightRef.current) {
      // A request is already in flight (e.g. React StrictMode's development-only
      // double effect invocation). Reuse it instead of firing a duplicate request.
      return;
    }

    requestInFlightRef.current = true;
    setPhase('loading');

    try {
      const result = await fetchAdminOnboardings({ filters });

      if (result.ok) {
        setRecords(result.data);
        setError(null);
        setPhase('ready');
      } else if (result.error.reason === 'invalid-input') {
        // Defensive fallback: preserve the last successful rows if the client
        // unexpectedly classifies a request as invalid input.
        setError(result.error);
        setPhase('ready');
      } else {
        setError(result.error);
        setPhase('error');
      }
    } finally {
      requestInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void load(createDefaultFilters());
  }, [load]);

  const applyFilters = useCallback(
    (filters: AdminOnboardingFilters): void => {
      if (phase === 'loading') {
        return;
      }

      setAppliedFilters(filters);
      void load(filters);
    },
    [load, phase],
  );

  const reload = useCallback((): void => {
    if (phase === 'loading') {
      return;
    }

    void load(appliedFilters);
  }, [appliedFilters, load, phase]);

  const resetFilters = useCallback((): void => {
    if (phase === 'loading') {
      return;
    }

    const nextFilters = createDefaultFilters();
    setAppliedFilters(nextFilters);
    void load(nextFilters);
  }, [load, phase]);

  return { phase, records, error, appliedFilters, applyFilters, reload, resetFilters };
}
