import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  fetchConnectorSettings,
  saveConnectorSettings,
  type ConnectorSettingsFetchError,
} from '../api/admin-connector-settings';
import type { ConnectorSettings, ConnectorSettingValues } from '../types/connector-settings';

const CONNECTOR_SETTINGS_QUERY_KEY = ['admin', 'connector-settings'] as const;

export type ConnectorSettingsPhase = 'loading' | 'error' | 'ready';

export interface SaveConnectorSettingsInput {
  connectorType: string;
  values: ConnectorSettingValues;
}

/** How the last save went, and which connector it was for, so only that form reports it. */
export interface ConnectorSaveStatus {
  connectorType: string;
  state: 'saving' | 'saved' | 'failed';
  /** Why it was refused; null unless the state is `failed`. */
  message: string | null;
}

export interface UseConnectorSettingsResult {
  phase: ConnectorSettingsPhase;
  connectors: ConnectorSettings[];
  error: ConnectorSettingsFetchError | null;
  saveStatus: ConnectorSaveStatus | null;
  save: (input: SaveConnectorSettingsInput) => void;
  refetch: () => void;
}

function toSaveStatus(
  mutation: UseMutationResult<
    ConnectorSettings,
    ConnectorSettingsFetchError,
    SaveConnectorSettingsInput
  >,
): ConnectorSaveStatus | null {
  if (mutation.isPending) {
    return { connectorType: mutation.variables.connectorType, state: 'saving', message: null };
  }

  if (mutation.isError) {
    return {
      connectorType: mutation.variables.connectorType,
      state: 'failed',
      message: mutation.error.message,
    };
  }

  if (mutation.isSuccess) {
    return { connectorType: mutation.data.connectorType, state: 'saved', message: null };
  }

  return null;
}

/**
 * Owns the connector settings the panel shows and the one write it can make. A successful save
 * returns the connector as it now stands, which replaces that entry in the cache — the panel
 * refreshes what changed without a second request, and without refetching the others.
 */
export function useConnectorSettings(): UseConnectorSettingsResult {
  const queryClient = useQueryClient();
  const { data, isFetching, isError, error, refetch } = useQuery<
    ConnectorSettings[],
    ConnectorSettingsFetchError
  >({
    queryKey: CONNECTOR_SETTINGS_QUERY_KEY,
    queryFn: fetchConnectorSettings,
  });

  const mutation = useMutation<
    ConnectorSettings,
    ConnectorSettingsFetchError,
    SaveConnectorSettingsInput
  >({
    mutationFn: ({ connectorType, values }) => saveConnectorSettings(connectorType, values),
    onSuccess: (saved) => {
      queryClient.setQueryData<ConnectorSettings[]>(CONNECTOR_SETTINGS_QUERY_KEY, (current) =>
        current?.map((connector) =>
          connector.connectorType === saved.connectorType ? saved : connector,
        ),
      );
    },
  });

  return {
    phase: isFetching ? 'loading' : isError ? 'error' : 'ready',
    connectors: data ?? [],
    error: error ?? null,
    saveStatus: toSaveStatus(mutation),
    save: mutation.mutate,
    refetch: () => {
      void refetch();
    },
  };
}
