import type { ChangeEvent, ReactElement } from 'react';
import { FilterField } from '@/shared/components/filters/FilterField';
import type { ConnectorSettingDraft } from '../utils/connector-settings-form';

export interface ConnectorSettingFieldProps {
  /** Scopes the input's id to its connector, so two cards never collide on the same setting key. */
  idPrefix: string;
  field: ConnectorSettingDraft;
  /** Operator-facing sentence already mapped by `describeConnectorSettingsIssue`, if this key was rejected. */
  error?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

/**
 * One labelled setting input. A secret renders as `type="password"` with
 * `autoComplete="new-password"` so the browser never offers to remember or autofill an
 * operator's credential (see Security Considerations); its value starts empty regardless of
 * `source`, because the engine never returns a stored secret's value.
 */
export function ConnectorSettingField({
  idPrefix,
  field,
  error,
  disabled,
  onChange,
}: ConnectorSettingFieldProps): ReactElement {
  const inputId = `${idPrefix}-${field.key}`;
  const errorId = `${inputId}-error`;
  const hasError = error !== undefined;

  const badges = [field.required ? 'required' : null, field.secret ? 'secret' : null].filter(
    (badge): badge is string => badge !== null,
  );
  const label = badges.length > 0 ? `${field.key} (${badges.join(', ')})` : field.key;

  // The two stored cases differ in what an empty box means, so they must not share a hint: a
  // secret's box is empty on every load and blank means keep, while a non-secret's box shows
  // its value and emptying it is the operator asking for the setting to be deleted.
  const stateHint =
    field.source === 'stored'
      ? field.secret
        ? 'Stored — leave blank to keep the stored value.'
        : 'Stored — clearing this box deletes the setting.'
      : 'Not set.';

  return (
    <FilterField controlId={inputId} label={label}>
      <input
        id={inputId}
        name={field.key}
        type={field.secret ? 'password' : 'text'}
        autoComplete={field.secret ? 'new-password' : 'off'}
        value={field.value}
        disabled={disabled}
        aria-invalid={hasError ? true : undefined}
        aria-describedby={hasError ? errorId : undefined}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
      <p className="connector-field__hint">{stateHint}</p>
      {hasError && (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      )}
    </FilterField>
  );
}
