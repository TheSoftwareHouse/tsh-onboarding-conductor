import type { ChangeEvent, ReactElement } from 'react';
import {
  describeConnectorSettingSource,
  type ConnectorSettingField as ConnectorSettingFieldValue,
} from '../types/connector-settings';

/** What the input shows in place of a value the panel is not allowed to read back. */
const SECRET_PLACEHOLDERS: Record<string, string> = {
  database: 'Saved — leave blank to keep it',
  environment: 'Set in the engine environment',
};

export interface ConnectorSettingFieldProps {
  connectorType: string;
  field: ConnectorSettingFieldValue;
  /** What the operator has typed, or undefined while the field is untouched. */
  draft: string | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
}

/**
 * One setting, in the state the engine reports it in. A secret is write-only: the input starts
 * empty whatever is stored, so leaving it alone keeps the stored value and typing replaces it.
 */
export function ConnectorSettingField({
  connectorType,
  field,
  draft,
  disabled,
  onChange,
}: ConnectorSettingFieldProps): ReactElement {
  const inputId = `${connectorType}-${field.key}`;
  const value = draft ?? (field.secret ? '' : (field.value ?? ''));
  const clearsStoredValue = field.source === 'database' && draft === '';
  const missing = field.required && field.source === 'unset';

  return (
    <div className="settings-field">
      <label htmlFor={inputId}>
        {field.label}
        {field.required && <span className="settings-field__required"> (required)</span>}
      </label>
      <input
        id={inputId}
        name={field.key}
        type={field.secret ? 'password' : 'text'}
        autoComplete="off"
        placeholder={field.secret ? SECRET_PLACEHOLDERS[field.source] : undefined}
        disabled={disabled}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
      <p className="settings-field__state">
        {describeConnectorSettingSource(field.source)}
        {field.hint !== undefined && ` · ${field.hint}`}
      </p>
      {clearsStoredValue && (
        <p className="settings-field__state">Saving removes the stored value.</p>
      )}
      {missing && <p className="field-error">The connector cannot run until this is set.</p>}
      {field.secret && field.source === 'database' && draft === undefined && (
        <button
          type="button"
          className="button--quiet settings-field__clear"
          disabled={disabled}
          onClick={() => onChange('')}
        >
          Clear saved value
        </button>
      )}
    </div>
  );
}
