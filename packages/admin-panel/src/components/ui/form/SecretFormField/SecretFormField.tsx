import { useState, type ReactElement, type ReactNode } from 'react';
import type { Control, FieldPath, FieldValues, UseControllerProps } from 'react-hook-form';
import { useController } from 'react-hook-form';
import { Input } from '@/components/ui/Input/Input';
import { Visibility, VisibilityOff } from '@/components/ui/icons';
import { FormField, fieldDescribedBy } from '../FormField/FormField';

export interface SecretFormFieldProps<TValues extends FieldValues> {
  control: Control<TValues>;
  name: FieldPath<TValues>;
  controlId: string;
  label: string;
  /** Declares the field required — renders the badge and `aria-required`. Does not enforce it. */
  isRequired?: boolean;
  badges?: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
  placeholder?: string;
  /** Names the value in the toggle's accessible name, e.g. `apiKey` reads as "Show apiKey". */
  revealLabel: string;
  /** Forwarded to `useController` — enforcement, kept separate from `isRequired`'s declaration. */
  rules?: UseControllerProps<TValues>['rules'];
}

/**
 * `FormField` wired to RHF for a credential: `autoComplete="off"` and vendor opt-outs, never
 * `new-password`. The eye reveals typed text, and is disabled while the box is empty.
 */
export function SecretFormField<TValues extends FieldValues>({
  control,
  name,
  controlId,
  label,
  isRequired,
  badges,
  trailing,
  disabled,
  placeholder,
  revealLabel,
  rules,
}: SecretFormFieldProps<TValues>): ReactElement {
  const [revealRequested, setRevealRequested] = useState(false);
  const { field, fieldState } = useController({ control, name, rules });
  const hasError = fieldState.error !== undefined;
  // `TValues` is generic, so the cast; the fallback covers a name absent from `defaultValues`.
  const value = (field.value ?? '') as string;
  const hasValue = value.length > 0;
  const revealed = revealRequested && hasValue;

  return (
    <FormField
      controlId={controlId}
      label={label}
      isRequired={isRequired}
      badges={badges}
      trailing={trailing}
      error={fieldState.error?.message}
    >
      <div className="flex gap-2">
        <Input
          id={controlId}
          type={revealed ? 'text' : 'password'}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          // Only ever matters once revealed, and a credential is exactly the string no browser
          // should offer to correct or capitalise.
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          font="mono"
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={hasError ? true : undefined}
          aria-required={isRequired ? true : undefined}
          aria-describedby={fieldDescribedBy(controlId, hasError)}
          name={field.name}
          onChange={field.onChange}
          onBlur={field.onBlur}
          ref={field.ref}
          value={value}
        />
        <button
          type="button"
          className="flex size-10 shrink-0 items-center justify-center border border-border-strong bg-bg-page text-fg-3 enabled:hover:border-tsh-black disabled:text-fg-disabled"
          // The accessible name carries the state, so there is no `aria-pressed` to disagree with it.
          aria-label={revealed ? `Hide ${revealLabel}` : `Show ${revealLabel}`}
          aria-controls={controlId}
          disabled={disabled || !hasValue}
          onClick={() => setRevealRequested((previous) => !previous)}
        >
          {revealed ? (
            <VisibilityOff aria-hidden="true" focusable="false" className="size-4.5" />
          ) : (
            <Visibility aria-hidden="true" focusable="false" className="size-4.5" />
          )}
        </button>
      </div>
    </FormField>
  );
}
