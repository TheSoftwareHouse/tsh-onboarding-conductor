import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  deleteWorkflowConnectorSelection,
  putWorkflowConnectorSelection,
  WorkflowConnectorSelectionWriteError,
} from '@/api/workflows/workflow-connector-selection';
import type { WorkflowStepConnectorWithFallbacks } from '@/api/workflows/workflow-definitions';
import { workflowQueries } from '@/api/workflows/workflow-queries';

/** Outcome a caller reacts to directly (a toast), without a second subscription to mutation state. */
export type ConnectorSelectionOutcome =
  { ok: true } | { ok: false; error: WorkflowConnectorSelectionWriteError };

export interface UseConnectorSelectionResult {
  select: (stepName: string, connectorId: string) => Promise<ConnectorSelectionOutcome>;
  clear: (stepName: string) => Promise<ConnectorSelectionOutcome>;
  isPending: boolean;
}

function toError(cause: unknown): WorkflowConnectorSelectionWriteError {
  return cause instanceof WorkflowConnectorSelectionWriteError
    ? cause
    : new WorkflowConnectorSelectionWriteError('Request failed.');
}

/** Selects or clears the runtime connector of one workflow's steps, refreshing every version's read on success. */
export function useConnectorSelection(workflowId: string): UseConnectorSelectionResult {
  const queryClient = useQueryClient();

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: workflowQueries.detailsFor(workflowId) }),
    [queryClient, workflowId],
  );

  const selectMutation = useMutation<
    WorkflowStepConnectorWithFallbacks,
    WorkflowConnectorSelectionWriteError,
    { stepName: string; connectorId: string }
  >({
    mutationFn: ({ stepName, connectorId }) =>
      putWorkflowConnectorSelection(workflowId, stepName, connectorId),
  });

  const clearMutation = useMutation<void, WorkflowConnectorSelectionWriteError, string>({
    mutationFn: (stepName) => deleteWorkflowConnectorSelection(workflowId, stepName),
  });

  const select = useCallback(
    async (stepName: string, connectorId: string): Promise<ConnectorSelectionOutcome> => {
      try {
        await selectMutation.mutateAsync({ stepName, connectorId });
        await refresh();
        return { ok: true };
      } catch (cause) {
        return { ok: false, error: toError(cause) };
      }
    },
    [refresh, selectMutation],
  );

  const clear = useCallback(
    async (stepName: string): Promise<ConnectorSelectionOutcome> => {
      try {
        await clearMutation.mutateAsync(stepName);
        await refresh();
        return { ok: true };
      } catch (cause) {
        return { ok: false, error: toError(cause) };
      }
    },
    [refresh, clearMutation],
  );

  return { select, clear, isPending: selectMutation.isPending || clearMutation.isPending };
}
