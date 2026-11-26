import { useCallback } from 'react';
import { useQueryStates } from 'nuqs';
import { useLocation, useNavigate } from 'react-router';
import {
  serializeDetailsSearch,
  workflowDetailsSearchParams,
  type WorkflowView,
} from '../utils/workflow-details-search-params';

export interface UseWorkflowDetailsSearchParamsResult {
  version: number | null;
  step: string | null;
  view: WorkflowView | null;
  setVersion: (version: number) => void;
  setStep: (step: string) => void;
  setView: (view: WorkflowView) => void;
}

/** Owns `?version=`, `?step=` and `?view=`; the page resolves them against what the engine actually has. */
export function useWorkflowDetailsSearchParams(): UseWorkflowDetailsSearchParamsResult {
  // `shallow: false` is load-bearing: without it `useLocation()` goes stale. See ADR 0018.
  const [{ version, step, view }, setState] = useQueryStates(workflowDetailsSearchParams, {
    history: 'replace',
    shallow: false,
  });

  const navigate = useNavigate();
  const { search } = useLocation();

  // Via the router so the draft's unsaved-changes guard can block it; nuqs swaps its state first and unmounts the guard.
  const setVersion = useCallback(
    (next: number): void =>
      void navigate(
        { search: serializeDetailsSearch(search, { version: next, step: null, view: null }) },
        { replace: true },
      ),
    [navigate, search],
  );
  const setStep = useCallback((next: string): void => void setState({ step: next }), [setState]);
  const setView = useCallback(
    (next: WorkflowView): void => void setState({ view: next }),
    [setState],
  );

  return { version, step, view, setVersion, setStep, setView };
}
