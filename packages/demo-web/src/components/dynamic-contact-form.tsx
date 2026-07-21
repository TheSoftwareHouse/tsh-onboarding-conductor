import type { FormEvent } from 'react';
import type { OnboardingActiveStepDescriptor, OnboardingJourneyFieldDescriptor } from '@tsh/shared';

export type FieldValues = Record<string, string | boolean>;
export type FieldErrors = Record<string, string>;

type DynamicContactFormProps = {
  step: OnboardingActiveStepDescriptor;
  values: FieldValues;
  fieldErrors: FieldErrors;
  submitting: boolean;
  onFieldChange: (name: string, value: string | boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function humanizeFieldName(name: string): string {
  const withSpaces = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function inputTypeFor(field: OnboardingJourneyFieldDescriptor): string {
  if (field.validation.kind === 'email') {
    return 'email';
  }
  if (field.validation.kind === 'phone') {
    return 'tel';
  }
  return 'text';
}

function describeFieldErrorCode(code: string): string {
  switch (code) {
    case 'INVALID_FORMAT':
      return 'This value is not in a valid format.';
    case 'REQUIRED':
      return 'This field is required.';
    case 'MUST_BE_TRUE':
      return 'You must accept this to continue.';
    default:
      return `This value was rejected (${code}).`;
  }
}

export function DynamicContactForm({
  step,
  values,
  fieldErrors,
  submitting,
  onFieldChange,
  onSubmit,
}: DynamicContactFormProps) {
  return (
    <form onSubmit={onSubmit} noValidate aria-busy={submitting} className="onboarding-form">
      {step.fields.map((field) => {
        const fieldId = `onboarding-field-${field.name}`;
        const errorId = `${fieldId}-error`;
        const errorCode = fieldErrors[field.name];
        const label = humanizeFieldName(field.name);

        if (field.type === 'boolean') {
          const checked = values[field.name] === true;

          return (
            <div className="onboarding-field" key={field.name}>
              <label htmlFor={fieldId}>
                <input
                  id={fieldId}
                  type="checkbox"
                  checked={checked}
                  disabled={submitting}
                  required={field.required}
                  aria-invalid={Boolean(errorCode)}
                  aria-describedby={errorCode ? errorId : undefined}
                  onChange={(event) => onFieldChange(field.name, event.target.checked)}
                />{' '}
                {label}
                {field.required ? ' (required)' : ''}
              </label>
              {errorCode ? (
                <p id={errorId} role="alert" className="onboarding-field-error">
                  {describeFieldErrorCode(errorCode)}
                </p>
              ) : null}
            </div>
          );
        }

        const value = typeof values[field.name] === 'string' ? (values[field.name] as string) : '';

        return (
          <div className="onboarding-field" key={field.name}>
            <label htmlFor={fieldId}>
              {label}
              {field.required ? ' (required)' : ''}
            </label>
            <input
              id={fieldId}
              type={inputTypeFor(field)}
              value={value}
              disabled={submitting}
              required={field.required}
              aria-invalid={Boolean(errorCode)}
              aria-describedby={errorCode ? errorId : undefined}
              onChange={(event) => onFieldChange(field.name, event.target.value)}
            />
            {errorCode ? (
              <p id={errorId} role="alert" className="onboarding-field-error">
                {describeFieldErrorCode(errorCode)}
              </p>
            ) : null}
          </div>
        );
      })}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Submitting…' : 'Submit'}
      </button>
    </form>
  );
}
