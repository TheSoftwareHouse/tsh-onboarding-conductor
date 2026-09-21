import { useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ConnectorSettingsWriteError,
  deleteConnectorSettings,
  fetchConnectors,
  patchConnectorSettings,
  type ConnectorsFetchError,
} from '../api/admin-connectors';
import type { Connector } from '../types/connector';

/** Outcome a card reacts to directly, without a second subscription to mutation state. */
export type ConnectorWriteOutcome =
  { ok: true } | { ok: false; error: ConnectorSettingsWriteError };

const CONNECTORS_QUERY_KEY = ['admin-connectors'] as const;

export interface UseConnectorsResult {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  connectors: Connector[];
  error: ConnectorsFetchError | null;
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
  const { data, isPending, isError, isSuccess, error, refetch } = useQuery<
    Connector[],
    ConnectorsFetchError
  >({
    queryKey: CONNECTORS_QUERY_KEY,
    queryFn: fetchConnectors,
  });

  const saveMutation = useMutation<
    Connector,
    ConnectorSettingsWriteError,
    { connectorId: string; changes: Record<string, string | null> }
  >({
    mutationFn: ({ connectorId, changes }) => patchConnectorSettings(connectorId, changes),
  });

  const clearMutation = useMutation<void, ConnectorSettingsWriteError, string>({
    mutationFn: (connectorId) => deleteConnectorSettings(connectorId),
  });

  const saveSettings = useCallback(
    async (
      connectorId: string,
      changes: Record<string, string | null>,
    ): Promise<ConnectorWriteOutcome> => {
      try {
        await saveMutation.mutateAsync({ connectorId, changes });
        refetch();
        return { ok: true };
      } catch (cause) {
        const error =
          cause instanceof ConnectorSettingsWriteError
            ? cause
            : new ConnectorSettingsWriteError('Request failed.');
        return { ok: false, error };
      }
    },
    [refetch, saveMutation],
  );

  const clearSettings = useCallback(
    async (connectorId: string): Promise<ConnectorWriteOutcome> => {
      try {
        await clearMutation.mutateAsync(connectorId);
        refetch();
        return { ok: true };
      } catch (cause) {
        const error =
          cause instanceof ConnectorSettingsWriteError
            ? cause
            : new ConnectorSettingsWriteError('Request failed.');
        return { ok: false, error };
      }
    },
    [refetch, clearMutation],
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
