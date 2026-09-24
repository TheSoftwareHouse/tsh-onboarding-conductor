import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { onboardingQueries } from '@/api/onboardings/onboarding-queries';
import type { AdminOnboardingSummary } from '@/api/onboardings/admin-onboardings';
import type { OnboardingTransition } from '@/api/onboardings/onboarding-transitions';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import type {
  WorkflowDefinition,
  WorkflowScoreDefinition,
} from '@/api/workflows/workflow-definitions';

const NO_TRANSITIONS: OnboardingTransition[] = [];
const NO_SCORES: OnboardingScoreView[] = [];

export type AdminOnboardingDetailsPhase = 'loading' | 'error' | 'ready';

/** A score joined to its declared bounds; `bounds` is null when the definition has none for it. */
export interface OnboardingScoreView {
  name: string;
  value: number;
  bounds: WorkflowScoreDefinition | null;
}

export interface UseAdminOnboardingDetailsResult {
  phase: AdminOnboardingDetailsPhase;
  /** Null once ready when no onboarding carries this id. */
  summary: AdminOnboardingSummary | null;
  transitions: OnboardingTransition[];
  /** The `occurredAt` of the most recently recorded transition, or null when there is none. */
  lastTransitionOccurredAt: string | null;
  /** The workflow definition this onboarding runs on, or null while it is unavailable. */
  definition: WorkflowDefinition | null;
  /** The onboarding's scores, each joined to its declared bounds. */
  scores: OnboardingScoreView[];
  /** True when the trail holds more moves than one request reads, so the chain starts mid-journey. */
  transitionsTruncated: boolean;
  /** Message of the first failed read, or null while nothing has failed. */
  error: string | null;
  refetch: () => void;
}

/** The onboarding's record and its transitions, read in parallel and reported as one phase. */
export function useAdminOnboardingDetails(onboardingId: string): UseAdminOnboardingDetailsResult {
  const summaryQuery = useQuery(onboardingQueries.detail(onboardingId));
  const transitionsQuery = useQuery(onboardingQueries.transitions(onboardingId));

  const transitions = transitionsQuery.data?.transitions ?? NO_TRANSITIONS;

  // The definition is looked up from the onboarding's own record, so it is read only once that
  // record names a workflow and a version.
  const summary = summaryQuery.data ?? null;
  const definitionQuery = useQuery({
    ...workflowQueries.detail(summary?.workflowId ?? '', summary?.workflowVersion ?? 0),
    enabled: summary !== null,
  });

  const definition = definitionQuery.data ?? null;

  const scores = useMemo<OnboardingScoreView[]>(() => {
    if (summary === null) {
      return NO_SCORES;
    }

    return Object.entries(summary.scores).map(([name, value]) => ({
      name,
      value,
      bounds: definition?.scores[name] ?? null,
    }));
  }, [summary, definition]);

  const refetch = useCallback((): void => {
    void summaryQuery.refetch();
    void transitionsQuery.refetch();
    // React Query's refetch() ignores `enabled`, so this stays guarded by the same condition.
    if (summary !== null) {
      void definitionQuery.refetch();
    }
  }, [definitionQuery, transitionsQuery, summaryQuery, summary]);

  const isFetching = summaryQuery.isFetching || transitionsQuery.isFetching;
  const isError = summaryQuery.isError || transitionsQuery.isError;

  return {
    // Mirrors the list view: any active fetch hides what is on screen rather than leaving stale
    // rows next to a newer status line.
    phase: isFetching ? 'loading' : isError ? 'error' : 'ready',
    summary: isFetching || isError ? null : summary,
    transitions: isFetching || isError ? [] : transitions,
    lastTransitionOccurredAt:
      isFetching || isError || transitions.length === 0
        ? null
        : transitions[transitions.length - 1].occurredAt,
    // The definition is an enrichment: a refused or malformed one leaves the recorded transitions
    // on screen rather than failing the whole view.
    definition: isFetching || isError || definitionQuery.isFetching ? null : definition,
    scores: isFetching || isError ? NO_SCORES : scores,
    transitionsTruncated: transitionsQuery.data?.truncated ?? false,
    error: (summaryQuery.error ?? transitionsQuery.error)?.message ?? null,
    refetch,
  };
}
