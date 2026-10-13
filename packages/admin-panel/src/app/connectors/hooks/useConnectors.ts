import { useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { connectorMutations } from '@/api/connectors/connector-mutations';
import { connectorQueries } from '@/api/connectors/connector-queries';
import type { Connector } from '@/api/connectors/connectors';
import { ApiError } from '@/services/api/api-error';

/** Outcome a card reacts to directly, without a second subscription to mutation state. */
export type ConnectorWriteOutcome = { ok: true } | { ok: false; error: ApiError };

export interface UseConnectorsResult {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  connectors: Connector[];
  error: ApiError | null;
  refetch: () => void;
  saveSettings: (
    connectorId: string,
    changes: Record<string, string | null>,
  ) => Promise<ConnectorWriteOutcome>;
  clearSettings: (connectorId: string) => Promise<ConnectorWriteOutcome>;
}

/**
 * Owns the connector list query and the save/clear writes for one connector at a time.
 *
 * Mirrors useAuditEvents' explicit-action philosophy: nothing here refetches on its own.
 * A write's own promise resolves to its outcome, so the page can react — reset a card's
 * drafts on success, render the engine's issues on failure — without a second subscription.
 * The list is refetched exactly once, and only after a write succeeds, so a rejected write
 * never clobbers what the operator typed with stale server data.
 */
export function useConnectors(): UseConnectorsResult {
  const { data, isPending, isError, isSuccess, error, refetch } = useQuery(connectorQueries.list());

  const saveMutation = useMutation(connectorMutations.save());
  const clearMutation = useMutation(connectorMutations.clear());

  const saveSettings = useCallback(
    async (
      connectorId: string,
      changes: Record<string, string | null>,
    ): Promise<ConnectorWriteOutcome> => {
      try {
        await saveMutation.mutateAsync({ connectorId, changes });
        return { ok: true };
      } catch (cause) {
        const error = cause instanceof ApiError ? cause : new ApiError('Request failed.');
        return { ok: false, error };
      }
    },
    [saveMutation],
  );

  const clearSettings = useCallback(
    async (connectorId: string): Promise<ConnectorWriteOutcome> => {
      try {
        await clearMutation.mutateAsync(connectorId);
        return { ok: true };
      } catch (cause) {
        const error = cause instanceof ApiError ? cause : new ApiError('Request failed.');
        return { ok: false, error };
      }
    },
    [clearMutation],
  );

  return {
    isPending,
    isError,
    isSuccess,
    connectors: data ?? [],
    error,
    refetch,
    saveSettings,
    clearSettings,
  };
}
