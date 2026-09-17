import type { ChangeEvent, ReactElement } from 'react';
import { FilterField } from '@/components/ui/filters/FilterField';
import { SecretInput } from './SecretInput/SecretInput';
import type { ConnectorSettingDraft } from '../../../../utils/connector-settings-form';

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
 * One labelled setting input. A secret renders as a `SecretInput` — masked by default, with an
 * eye button that reveals what the operator has typed so a long pasted credential can be
 * proof-read before saving; its value starts empty regardless of `source`, because the engine
 * never returns a stored secret's value, so the eye can only ever show newly entered text.
 *
 * That empty box is indistinguishable from an unset one at a glance, so a stored setting is
 * marked two ways: a "Stored" pill and a masked placeholder standing in for the value the engine
 * withholds. The placeholder is a fixed width and deliberately does **not** track the real
 * value's length — the engine never sends it, and sending it would leak the size of a credential
 * for no operator benefit.
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
  const hintId = `${inputId}-hint`;
  const hasError = error !== undefined;
  const isStored = field.source === 'stored';

  const badges = [field.required ? 'required' : null, field.secret ? 'secret' : null].filter(
    (badge): badge is string => badge !== null,
  );
  const label = badges.length > 0 ? `${field.key} (${badges.join(', ')})` : field.key;

  // A stored setting is named by its pill alone; only the unset case needs saying in words,
  // since there is no pill to read its state off.
  const stateHint = isStored ? undefined : 'Not set.';

  /** Stands in for the value the engine withholds; a fixed width, never the real length. */
  const storedSecretMask = '••••••••••••';

  // The stored/unset state is the whole point of the line, so it is described unconditionally
  // rather than only when a value was refused — otherwise a screen reader hears the label and an
  // empty box, with nothing saying the engine already holds a credential.
  const describedBy = hasError ? `${hintId} ${errorId}` : hintId;

  return (
    <FilterField controlId={inputId} label={label}>
      <div className="connector-field__control">
        {field.secret ? (
          <SecretInput
            id={inputId}
            name={field.key}
            label={field.key}
            value={field.value}
            placeholder={isStored ? storedSecretMask : undefined}
            disabled={disabled}
            invalid={hasError}
            describedBy={describedBy}
            onChange={onChange}
          />
        ) : (
          <input
            id={inputId}
            name={field.key}
            type="text"
            autoComplete="off"
            value={field.value}
            disabled={disabled}
            aria-invalid={hasError ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
          />
        )}
      </div>
      <p id={hintId} className="connector-field__hint">
        {isStored && <span className="connector-field__stored">Stored</span>}
        {stateHint}
      </p>
      {hasError && (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      )}
    </FilterField>
  );
}
