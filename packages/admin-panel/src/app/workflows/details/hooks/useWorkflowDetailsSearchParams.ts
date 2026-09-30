import { useCallback } from 'react';
import { useQueryStates } from 'nuqs';
import { workflowDetailsSearchParams } from '../utils/workflow-details-search-params';

export interface UseWorkflowDetailsSearchParamsResult {
  version: number | null;
  step: string | null;
  setVersion: (version: number) => void;
  setStep: (step: string) => void;
}

/** Owns `?version=` and `?step=`; the page resolves both against what the engine actually has. */
export function useWorkflowDetailsSearchParams(): UseWorkflowDetailsSearchParamsResult {
  // `shallow: false` is load-bearing: without it `useLocation()` goes stale. See ADR 0018.
  const [{ version, step }, setState] = useQueryStates(workflowDetailsSearchParams, {
    history: 'replace',
    shallow: false,
  });

  // A new version always opens on its initial step.
  const setVersion = useCallback(
    (next: number): void => void setState({ version: next, step: null }),
    [setState],
  );
  const setStep = useCallback((next: string): void => void setState({ step: next }), [setState]);

  return { version, step, setVersion, setStep };
}
