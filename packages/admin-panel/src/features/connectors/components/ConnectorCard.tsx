import { useState, type FormEvent, type ReactElement } from 'react';
import { SecretInput } from '@/shared/components/SecretInput';
import { formatNullableDateTime, formatNullableText } from '@/shared/lib/format-date-time';
import type { Connector, ConnectorSettingsIssue } from '../types/connector';
import {
  buildConnectorSettingsChanges,
  canSubmitConnectorSettings,
  describeConnectorSettingsIssue,
  type ConnectorSettingsDraft,
} from '../utils/connector-settings-form';
import { ConnectorSettingField } from './ConnectorSettingField';

export interface ConnectorCardProps {
  connector: Connector;
  draft: ConnectorSettingsDraft;
  /** Per-key issues from the connector's last rejected write, or `[]` once it succeeds. */
  issues: ConnectorSettingsIssue[];
  /** True while this connector's own save or clear is in flight; another card's write leaves this false. */
  pending: boolean;
  onFieldChange: (key: string, value: string) => void;
  /**
   * Drops a declared field from the draft entirely. Only offered when `allowAdditionalKeys` is
   * true, because today that is the only case where a settings-view row is a dynamic key rather
   * than a fixed part of the connector's schema (see `buildView` in
   * `connector-settings-admin.service.ts`, which appends stored additional keys onto the same
   * `settings` array the schema's own fields populate).
   */
  onRemoveField: (key: string) => void;
  onAddCustomKey: () => void;
  onCustomKeyNameChange: (index: number, name: string) => void;
  onCustomKeyValueChange: (index: number, value: string) => void;
  onRemoveCustomKey: (index: number) => void;
  onSave: (changes: Record<string, string | null>) => void;
  onClear: () => void;
}

/**
 * One connector's settings form the operator edits incrementally rather than restates in
 * full: Save sends only the changes `buildConnectorSettingsChanges` detects against each
 * field's `initialValue`, so a stored secret's untouched, blank box is never mistaken for a
 * deletion. Clear is a `DELETE` and is irreversible, so it sits behind a confirm step rather
 * than firing on the first click.
 */
export function ConnectorCard({
  connector,
  draft,
  issues,
  pending,
  onFieldChange,
  onRemoveField,
  onAddCustomKey,
  onCustomKeyNameChange,
  onCustomKeyValueChange,
  onRemoveCustomKey,
  onSave,
  onClear,
}: ConnectorCardProps): ReactElement {
  const [confirmingClear, setConfirmingClear] = useState(false);
  const canSubmit = canSubmitConnectorSettings(draft);
  const idPrefix = `connector-${connector.id}`;
  /**
   * `configured` only means "no required key is missing" — `smtp` and `http_request` declare
   * none, so the engine reports `configured: true` even with an entirely empty settings map.
   * That is correct engine semantics and the chip keeps reporting it verbatim; this just adds
   * the fact an operator needs to not mistake the empty form for a rendering bug. An empty
   * `settings` list counts as nothing stored rather than as an edge case to exclude, since
   * `http_request` declares no fields and is the connector whose bare "Configured" card most
   * needs the explanation.
   */
  const hasNoStoredSettings = connector.settings.every((setting) => setting.source === 'unset');

  function findIssue(key: string): ConnectorSettingsIssue | undefined {
    return issues.find((issue) => issue.key === key);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit || pending) {
      return;
    }
    onSave(buildConnectorSettingsChanges(draft));
  }

  function handleClearClick(): void {
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    setConfirmingClear(false);
    onClear();
  }

  return (
    <form
      className="detail-card connector-card"
      aria-label={`${connector.name} connector settings`}
      onSubmit={handleSubmit}
    >
      <header className="connector-card__header">
        <div>
          <h3 className="connector-card__name">{connector.name}</h3>
          {/* Most adapters name themselves after their id; only show it when it adds something. */}
          {connector.id === connector.name ? null : (
            <p className="connector-card__type">{connector.id}</p>
          )}
        </div>
        <div className="connector-card__meta">
          <span className={connector.configured ? 'chip chip--accent' : 'chip'}>
            {connector.configured ? 'Configured' : 'Not configured'}
          </span>
          <p className="connector-card__updated">
            Updated {formatNullableDateTime(connector.updatedAt)} by{' '}
            {formatNullableText(connector.updatedBy)}
          </p>
        </div>
      </header>

      {connector.configured && hasNoStoredSettings && (
        <p className="status-region connector-card__hint">
          No settings are stored for this connector.
        </p>
      )}

      <div className="connector-card__fields">
        {draft.fields.map((field) => {
          const issue = findIssue(field.key);
          return (
            <ConnectorSettingField
              key={field.key}
              idPrefix={idPrefix}
              field={field}
              error={issue ? describeConnectorSettingsIssue(issue.reason) : undefined}
              disabled={pending}
              action={
                // Only a stored key can be removed. Offering it for an unset one would send a
                // `null` for a key the engine has nothing to delete — a write that changes
                // nothing yet still records an audit row naming the key.
                connector.allowAdditionalKeys && field.source === 'stored' ? (
                  <button
                    type="button"
                    className="button--quiet connector-field__remove"
                    disabled={pending}
                    onClick={() => onRemoveField(field.key)}
                  >
                    Remove key
                  </button>
                ) : undefined
              }
              onChange={(value) => onFieldChange(field.key, value)}
            />
          );
        })}
      </div>

      {connector.allowAdditionalKeys && (
        <div className="connector-card__custom-keys">
          <h4 className="detail-card__title">Additional keys</h4>
          {draft.customKeys.map((customKey, index) => {
            const issue = findIssue(customKey.name.trim());
            const nameId = `${idPrefix}-custom-key-${index}-name`;
            const valueId = `${idPrefix}-custom-key-${index}-value`;
            const errorId = `${nameId}-error`;
            // Only the engine judges a key name, so this is whatever it reported for this key.
            const error = issue ? describeConnectorSettingsIssue(issue.reason) : undefined;

            return (
              <div
                key={index}
                className="connector-key-row"
                role="group"
                aria-label="Additional key"
              >
                <div className="filter-field">
                  <label htmlFor={nameId}>Key name</label>
                  <input
                    id={nameId}
                    type="text"
                    value={customKey.name}
                    disabled={pending}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    onChange={(event) => onCustomKeyNameChange(index, event.target.value)}
                  />
                </div>
                <div className="filter-field">
                  <label htmlFor={valueId}>Key value</label>
                  {/* An alias key holds a credential too, so it is masked and revealable like a
                      declared secret. Named "the key value" rather than by its key, which the
                      operator may not have typed yet. */}
                  <SecretInput
                    id={valueId}
                    label="the key value"
                    value={customKey.value}
                    disabled={pending}
                    onChange={(value) => onCustomKeyValueChange(index, value)}
                  />
                </div>
                <button
                  type="button"
                  className="button--quiet"
                  disabled={pending}
                  onClick={() => onRemoveCustomKey(index)}
                >
                  Remove key
                </button>
                {error && (
                  <p id={errorId} className="field-error" role="alert">
                    {error}
                  </p>
                )}
              </div>
            );
          })}
          <button
            type="button"
            className="button--quiet"
            disabled={pending}
            onClick={onAddCustomKey}
          >
            Add key
          </button>
        </div>
      )}

      <div className="connector-card__actions">
        <button type="submit" className="button--primary" disabled={!canSubmit || pending}>
          Save
        </button>
        {confirmingClear && (
          <span className="connector-card__clear-confirm">
            Clear this connector&apos;s settings?
          </span>
        )}
        <button type="button" disabled={pending} onClick={handleClearClick}>
          {confirmingClear ? 'Confirm clear' : 'Clear'}
        </button>
        {confirmingClear && (
          <button
            type="button"
            className="button--quiet"
            disabled={pending}
            onClick={() => setConfirmingClear(false)}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
