import { useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { workflowMutations } from '@/api/workflows/workflow-mutations';
import { ApiError } from '@/services/api/api-error';

/** Outcome a caller reacts to directly (a toast), without a second subscription to mutation state. */
export type ConnectorSelectionOutcome = { ok: true } | { ok: false; error: ApiError };

export interface UseConnectorSelectionResult {
  select: (stepName: string, connectorId: string) => Promise<ConnectorSelectionOutcome>;
  clear: (stepName: string) => Promise<ConnectorSelectionOutcome>;
  isPending: boolean;
}

function toError(cause: unknown): ApiError {
  return cause instanceof ApiError ? cause : new ApiError('Request failed.');
}

/**
 * Selects or clears the runtime connector of one workflow's steps. The factories' meta awaits
 * every read of the family, so an outcome resolves once the new slot is on screen.
 */
export function useConnectorSelection(workflowId: string): UseConnectorSelectionResult {
  const selectMutation = useMutation(workflowMutations.selectConnector(workflowId));
  const clearMutation = useMutation(workflowMutations.clearConnector(workflowId));

  const select = useCallback(
    async (stepName: string, connectorId: string): Promise<ConnectorSelectionOutcome> => {
      try {
        await selectMutation.mutateAsync({ stepName, connectorId });
        return { ok: true };
      } catch (cause) {
        return { ok: false, error: toError(cause) };
      }
    },
    [selectMutation],
  );

  const clear = useCallback(
    async (stepName: string): Promise<ConnectorSelectionOutcome> => {
      try {
        await clearMutation.mutateAsync(stepName);
        return { ok: true };
      } catch (cause) {
        return { ok: false, error: toError(cause) };
      }
    },
    [clearMutation],
  );

  return { select, clear, isPending: selectMutation.isPending || clearMutation.isPending };
}
