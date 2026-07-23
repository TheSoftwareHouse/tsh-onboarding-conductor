import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAdminOnboardings, type AdminOnboardingsFetchError } from '../api/admin-onboardings';
import type { AdminOnboardingSummary } from '../types/admin-onboarding';

export type AdminOnboardingsPhase = 'loading' | 'error' | 'ready';

export interface UseAdminOnboardingsResult {
  phase: AdminOnboardingsPhase;
  records: AdminOnboardingSummary[];
  error: AdminOnboardingsFetchError | null;
  reload: () => void;
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
  const requestInFlightRef = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    if (requestInFlightRef.current) {
      // A request is already in flight (e.g. React StrictMode's development-only
      // double effect invocation). Reuse it instead of firing a duplicate request.
      return;
    }

    requestInFlightRef.current = true;
    setPhase('loading');

    try {
      const result = await fetchAdminOnboardings();

      if (result.ok) {
        setRecords(result.data);
        setError(null);
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
    void load();
  }, [load]);

  const reload = useCallback((): void => {
    if (phase === 'loading') {
      return;
    }
    void load();
  }, [load, phase]);

  return { phase, records, error, reload };
}
