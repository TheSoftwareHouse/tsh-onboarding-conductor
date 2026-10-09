import type { HTMLInputAutoCompleteAttribute, ReactElement, ReactNode } from 'react';
import type { Control, FieldPath, FieldValues, UseControllerProps } from 'react-hook-form';
import { useController } from 'react-hook-form';
import { Input, type InputFont } from '@/components/ui/Input/Input';
import { FormField, fieldDescribedBy } from '../FormField/FormField';

export interface TextFormFieldProps<TValues extends FieldValues, TTransformedValues = TValues> {
  /** A form with a resolver may submit a different shape than it holds; `TTransformedValues` is that shape. */
  control: Control<TValues, unknown, TTransformedValues>;
  name: FieldPath<TValues>;
  controlId: string;
  label: string;
  /** Declares the field required — renders the badge and `aria-required`. Does not enforce it. */
  isRequired?: boolean;
  badges?: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
  font?: InputFont;
  placeholder?: string;
  /** Left to the browser when omitted; a caller whose values must not be suggested passes `"off"`. */
  autoComplete?: HTMLInputAutoCompleteAttribute;
  /** Forwarded to `useController` — enforcement, kept separate from `isRequired`'s declaration. */
  rules?: UseControllerProps<TValues, FieldPath<TValues>, TTransformedValues>['rules'];
}

/**
 * `FormField` wired to `react-hook-form` through `useController`: labels and describes the
 * control, surfaces `fieldState.error` without an `error` prop, and writes keystrokes through to
 * the form.
 */
export function TextFormField<TValues extends FieldValues, TTransformedValues = TValues>({
  control,
  name,
  controlId,
  label,
  isRequired,
  badges,
  trailing,
  disabled,
  font,
  placeholder,
  autoComplete,
  rules,
}: TextFormFieldProps<TValues, TTransformedValues>): ReactElement {
  const { field, fieldState } = useController({ control, name, rules });
  const hasError = fieldState.error !== undefined;
  // `TValues` is generic here, so nothing proves this path's value is a string — every consumer's
  // own form-values type does. A name absent from `defaultValues` yields `undefined`, so this
  // falls back to an empty string rather than an input silently switching from controlled to
  // uncontrolled.
  const value = (field.value ?? '') as string;

  return (
    <FormField
      controlId={controlId}
      label={label}
      isRequired={isRequired}
      badges={badges}
      trailing={trailing}
      error={fieldState.error?.message}
    >
      <Input
        id={controlId}
        type="text"
        autoComplete={autoComplete}
        font={font}
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
    </FormField>
  );
}
