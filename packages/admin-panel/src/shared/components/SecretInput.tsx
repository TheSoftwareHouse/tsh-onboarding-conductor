import { useState, type ChangeEvent, type ReactElement } from 'react';

export interface SecretInputProps {
  /** Id the surrounding field's own `<label>` points at, so the toggle never takes the label. */
  id: string;
  /** Form name the value is submitted under; omitted where the row has no stable key yet. */
  name?: string;
  value: string;
  /** Shown while the box is empty — a mask standing in for a value the panel does not hold. */
  placeholder?: string;
  disabled: boolean;
  invalid?: boolean;
  /** Id of the hint and/or error text describing the value, passed straight to `aria-describedby`. */
  describedBy?: string;
  /** Names the value in the toggle's accessible name, e.g. `apiKey` reads as "Show apiKey". */
  label: string;
  onChange: (value: string) => void;
}

/** Click to show. */
function EyeIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3.25" />
    </svg>
  );
}

/** Click to hide again. */
function EyeOffIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M17.9 17.9A10.9 10.9 0 0 1 12 19.5C5.5 19.5 1.5 12 1.5 12a19 19 0 0 1 5.2-5.9m3.4-1.4A11 11 0 0 1 12 4.5c6.5 0 10.5 7.5 10.5 7.5a19.4 19.4 0 0 1-2.3 3.3m-6.1-1.2a3.25 3.25 0 0 1-4.4-4.4" />
      <path d="M2.5 2.5l19 19" />
    </svg>
  );
}

/**
 * A credential input the operator can read back. It stays `type="password"` with
 * `autoComplete="new-password"` by default — the browser must never offer to remember or autofill
 * a credential — and the eye button swaps it to `type="text"` so a long pasted key can be
 * proof-read before it is saved.
 *
 * The toggle is offered only once the box holds something. A stored secret's box is always empty,
 * because the engine never returns a stored value, so an enabled eye there would promise a reveal
 * it cannot deliver — and, worse, would show the masked placeholder as though the credential
 * really were a row of dots. Emptying the box likewise falls back to hidden, which keeps that
 * placeholder honest without making the toggle forget the operator asked to see the value.
 */
export function SecretInput({
  id,
  name,
  value,
  placeholder,
  disabled,
  invalid,
  describedBy,
  label,
  onChange,
}: SecretInputProps): ReactElement {
  const [revealRequested, setRevealRequested] = useState(false);
  const hasValue = value.length > 0;
  const revealed = revealRequested && hasValue;

  return (
    <div className="secret-input">
      <input
        id={id}
        name={name}
        type={revealed ? 'text' : 'password'}
        autoComplete="new-password"
        // Only ever matters once revealed, and a credential is exactly the string no browser
        // should offer to correct or capitalise.
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid === true ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="secret-input__toggle"
        // The accessible name carries the state, so there is no `aria-pressed` to disagree with it.
        aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
        aria-controls={id}
        disabled={disabled || !hasValue}
        onClick={() => setRevealRequested((previous) => !previous)}
      >
        {revealed ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}
