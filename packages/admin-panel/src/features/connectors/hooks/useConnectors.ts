import { useCallback, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ConnectorSettingsWriteError,
  deleteConnectorSettings,
  fetchConnectors,
  patchConnectorSettings,
  type ConnectorsFetchError,
} from '../api/admin-connectors';
import type { Connector } from '../types/connector';

export type ConnectorsPhase = 'loading' | 'error' | 'ready';

/** Outcome a card reacts to directly, without a second subscription to mutation state. */
export type ConnectorWriteOutcome =
  { ok: true } | { ok: false; error: ConnectorSettingsWriteError };

const CONNECTORS_QUERY_KEY = ['admin-connectors'] as const;

export interface UseConnectorsResult {
  phase: ConnectorsPhase;
  connectors: Connector[];
  error: ConnectorsFetchError | null;
  refetch: () => void;
  /** The connector type a save or clear is in flight for, or null while no write is pending. */
  pendingConnectorId: string | null;
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
  const { data, isLoading, isError, error, refetch } = useQuery<Connector[], ConnectorsFetchError>({
    queryKey: CONNECTORS_QUERY_KEY,
    queryFn: fetchConnectors,
  });

  // Tracked separately from the mutations' own `isPending` because a second card starting a
  // write while the first is still in flight would otherwise overwrite which variables a
  // shared mutation object reports, an ambiguity a single "which connector" value avoids.
  const [pendingConnectorId, setPendingConnectorId] = useState<string | null>(null);

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
      setPendingConnectorId(connectorId);
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
      } finally {
        setPendingConnectorId(null);
      }
    },
    [refetch, saveMutation],
  );

  const clearSettings = useCallback(
    async (connectorId: string): Promise<ConnectorWriteOutcome> => {
      setPendingConnectorId(connectorId);
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
      } finally {
        setPendingConnectorId(null);
      }
    },
    [refetch, clearMutation],
  );

  return {
    // `isLoading` (no data yet AND a fetch in flight), not `isFetching` — unlike
    // useAuditEvents, whose phase must track `isFetching` so a filter change hides stale
    // rows immediately, a connector write's own post-success refetch must not blank the
    // list: doing so would unmount every card, including ones the operator did not touch,
    // and discard their local drafts (the per-card isolation Task 2.3 requires). So once the
    // first load has landed, `phase` stays `ready` and `connectors` keeps reporting the
    // last-fetched list while a refetch is in flight.
    phase: isLoading ? 'loading' : isError ? 'error' : 'ready',
    connectors: data ?? [],
    error,
    refetch,
    pendingConnectorId,
    saveSettings,
    clearSettings,
  };
}
