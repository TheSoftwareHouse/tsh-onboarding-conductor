import type { FormEvent, ReactElement } from 'react';
import { useEffect, useState } from 'react';
import type { ConnectorSettings, ConnectorSettingValues } from '../types/connector-settings';
import { ConnectorSettingField } from './ConnectorSettingField';

export interface ConnectorSettingsFormProps {
  connector: ConnectorSettings;
  disabled: boolean;
  /** How the last save of this connector went, or null when it has not been saved. */
  statusMessage: string | null;
  /** Receives only the settings the operator edited. */
  onSave: (values: ConnectorSettingValues) => void;
}

/**
 * One connector's credentials. Submits only what was edited, so saving a sender address never
 * asks the operator to re-type the API key beside it.
 */
export function ConnectorSettingsForm({
  connector,
  disabled,
  statusMessage,
  onSave,
}: ConnectorSettingsFormProps): ReactElement {
  const [drafts, setDrafts] = useState<ConnectorSettingValues>({});

  // A save returns the connector as it now stands, so the edits it accepted are no longer drafts.
  useEffect(() => {
    setDrafts({});
  }, [connector]);

  const edited = Object.keys(drafts).length > 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSave(drafts);
  };

  return (
    <form
      className="settings-card"
      aria-label={connector.label}
      onSubmit={handleSubmit}
      onReset={() => setDrafts({})}
    >
      <div className="settings-card__header">
        <h2 className="settings-card__title">{connector.label}</h2>
        <span className="settings-card__type">{connector.connectorType}</span>
      </div>
      <div className="settings-card__grid">
        {connector.fields.map((field) => (
          <ConnectorSettingField
            key={field.key}
            connectorType={connector.connectorType}
            field={field}
            draft={drafts[field.key]}
            disabled={disabled}
            onChange={(value: string) =>
              setDrafts((current) => ({ ...current, [field.key]: value }))
            }
          />
        ))}
      </div>
      <div className="settings-card__actions">
        <button type="submit" className="button--primary" disabled={disabled || !edited}>
          Save changes
        </button>
        <button type="reset" className="button--quiet" disabled={disabled || !edited}>
          Discard changes
        </button>
        {/* Beside the actions rather than above them: an always-rendered block would leave a gap
            in every card that has nothing to report. */}
        <p className="status-region" role="status">
          {statusMessage ?? ''}
        </p>
      </div>
    </form>
  );
}
