import type { ReactElement } from 'react';
import {
  ConnectorSettingsForm,
  useConnectorSettings,
  type ConnectorSaveStatus,
  type ConnectorSettingsFetchError,
} from '@/features/connectors';

function describeFetchError(error: ConnectorSettingsFetchError | null): string {
  return error === null
    ? 'Unable to load connector settings.'
    : `Unable to load connector settings: ${error.message}`;
}

function describeSaveStatus(status: ConnectorSaveStatus): string | null {
  switch (status.state) {
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved. The new values are used from the next connector call onwards.';
    default:
      return status.message;
  }
}

/**
 * Connector credentials, one form per connector. Every value an operator does not set here stays
 * with the engine's own environment, which each field says outright.
 */
export function AdminConnectorsPage(): ReactElement {
  const { phase, connectors, error, saveStatus, save, refetch } = useConnectorSettings();

  const statusMessage =
    phase === 'loading'
      ? 'Loading connector settings…'
      : phase === 'error'
        ? describeFetchError(error)
        : `Showing ${connectors.length} configurable connectors.`;

  return (
    <>
      <div className="settings-header">
        <p className="status-region" role="status">
          {statusMessage}
        </p>
        <button type="button" disabled={phase === 'loading'} onClick={refetch}>
          Reload
        </button>
      </div>
      <div className="settings-list">
        {connectors.map((connector) => {
          const status =
            saveStatus?.connectorType === connector.connectorType ? saveStatus : undefined;

          return (
            <ConnectorSettingsForm
              key={connector.connectorType}
              connector={connector}
              disabled={phase === 'loading' || status?.state === 'saving'}
              statusMessage={status === undefined ? null : describeSaveStatus(status)}
              onSave={(values) => save({ connectorType: connector.connectorType, values })}
            />
          );
        })}
      </div>
    </>
  );
}
