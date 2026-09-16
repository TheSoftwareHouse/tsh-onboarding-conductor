import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchOnboardingTransitions } from '../api/admin-onboarding-transitions';
import { fetchAdminOnboardingById } from '../../api/admin-onboardings';
import { fetchWorkflowDefinition } from '../api/admin-workflow-definition';
import type { AdminOnboardingSummary } from '../../types/admin-onboarding';
import type { WorkflowScoreDefinition } from '../types/workflow-definition';
import { buildWorkflowPath } from '../utils/workflow-path';
import { layoutWorkflowGraph, type WorkflowGraph } from '../utils/workflow-graph-layout';
import type { OnboardingTransition } from '../utils/onboarding-transitions';

export const ONBOARDING_SUMMARY_QUERY_KEY_PREFIX = 'admin-onboarding-summary' as const;
export const WORKFLOW_DEFINITION_QUERY_KEY_PREFIX = 'admin-workflow-definition' as const;
export const ONBOARDING_TRANSITIONS_QUERY_KEY_PREFIX = 'admin-onboarding-transitions' as const;

const NO_TRANSITIONS: OnboardingTransition[] = [];
const NO_SCORES: OnboardingScoreView[] = [];

export type AdminOnboardingDetailsPhase = 'loading' | 'error' | 'ready';

/**
 * One of the onboarding's scores joined to its declared bounds. `bounds` is null when the
 * workflow definition does not declare a score of this name - or is not yet available - so the
 * value still renders without them rather than being hidden.
 */
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
  /**
   * The whole declared workflow with this onboarding's path marked on it, or null while the
   * definition is unavailable - which leaves the recorded transitions as the only account.
   */
  graph: WorkflowGraph | null;
  /** The onboarding's scores, each joined to its declared bounds. */
  scores: OnboardingScoreView[];
  /** True when the trail holds more moves than one request reads, so the chain starts mid-journey. */
  transitionsTruncated: boolean;
  /** Message of the first failed read, or null while nothing has failed. */
  error: string | null;
  refetch: () => void;
}

/**
 * Reads everything the details page shows: the onboarding's own record, and the chain of states it
 * moved through. The two are separate endpoints, so they are read in parallel and reported as one
 * phase - the page has nothing useful to show until both have answered.
 */
export function useAdminOnboardingDetails(onboardingId: string): UseAdminOnboardingDetailsResult {
  const summaryQuery = useQuery({
    queryKey: [ONBOARDING_SUMMARY_QUERY_KEY_PREFIX, onboardingId],
    queryFn: () => fetchAdminOnboardingById(onboardingId),
  });
  const transitionsQuery = useQuery({
    queryKey: [ONBOARDING_TRANSITIONS_QUERY_KEY_PREFIX, onboardingId],
    queryFn: () => fetchOnboardingTransitions(onboardingId),
  });

  const transitions = transitionsQuery.data?.transitions ?? NO_TRANSITIONS;

  // The definition is looked up from the onboarding's own record, so it is read only once that
  // record names a workflow and a version.
  const summary = summaryQuery.data ?? null;
  const definitionQuery = useQuery({
    queryKey: [
      WORKFLOW_DEFINITION_QUERY_KEY_PREFIX,
      summary?.workflowId ?? '',
      summary?.workflowVersion ?? 0,
    ],
    queryFn: () => fetchWorkflowDefinition(summary!.workflowId, summary!.workflowVersion),
    enabled: summary !== null,
  });

  const definition = definitionQuery.data ?? null;
  const graph = useMemo(
    () =>
      definition === null ? null : layoutWorkflowGraph(definition, buildWorkflowPath(transitions)),
    [definition, transitions],
  );

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
    void definitionQuery.refetch();
  }, [definitionQuery, transitionsQuery, summaryQuery]);

  const isFetching = summaryQuery.isFetching || transitionsQuery.isFetching;
  const isError = summaryQuery.isError || transitionsQuery.isError;

  return {
    // Mirrors the list view: any active fetch hides what is on screen rather than leaving stale
    // rows next to a newer status line.
    phase: isFetching ? 'loading' : isError ? 'error' : 'ready',
    summary: isFetching || isError ? null : summary,
    transitions: isFetching || isError ? [] : transitions,
    // The graph is an enrichment: a refused or malformed definition leaves the recorded
    // transitions on screen rather than failing the whole view.
    graph: isFetching || isError || definitionQuery.isFetching ? null : graph,
    scores: isFetching || isError ? NO_SCORES : scores,
    transitionsTruncated: transitionsQuery.data?.truncated ?? false,
    error: (summaryQuery.error ?? transitionsQuery.error)?.message ?? null,
    refetch,
  };
}
