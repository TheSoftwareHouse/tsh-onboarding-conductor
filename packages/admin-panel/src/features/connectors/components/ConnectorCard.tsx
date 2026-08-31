import { useState, type FormEvent, type ReactElement } from 'react';
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
  onSave,
  onClear,
}: ConnectorCardProps): ReactElement {
  const [confirmingClear, setConfirmingClear] = useState(false);
  const canSubmit = canSubmitConnectorSettings(draft);
  const idPrefix = `connector-${connector.id}`;
  /**
   * `configured` only means "no required key is missing" — `smtp` declares none, so the engine
   * reports `configured: true` even with an entirely empty settings map. That is correct engine
   * semantics and the chip keeps reporting it verbatim; this just adds the fact an operator
   * needs to not mistake the empty form for a rendering bug.
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
              onChange={(value) => onFieldChange(field.key, value)}
            />
          );
        })}
      </div>

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
