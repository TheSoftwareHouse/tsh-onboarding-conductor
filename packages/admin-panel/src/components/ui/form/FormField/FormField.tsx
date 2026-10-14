import type { ReactElement, ReactNode } from 'react';
import { Chip } from '@/components/ui/Chip/Chip';
import { Typography } from '@/components/ui/Typography/Typography';

export interface FormFieldProps {
  controlId: string;
  label: string;
  /** Renders the `required` chip first, ahead of `badges`. */
  isRequired?: boolean;
  /** Inline after the label, appended after the required chip — e.g. the `secret` chip. */
  badges?: ReactNode;
  /** Right-aligned in the label row; a short tag. Describes the field unless `description` is set. */
  trailing?: ReactNode;
  /** A sentence under the control; takes the hint id over `trailing`. */
  description?: ReactNode;
  error?: string;
  children: ReactNode;
}

/** Single source of truth for the id scheme both halves derive from. */
export function fieldIds(controlId: string): { hintId: string; errorId: string } {
  return { hintId: `${controlId}-hint`, errorId: `${controlId}-error` };
}

/** The hint always describes the field; the error id joins it only once a value was refused. */
export function fieldDescribedBy(controlId: string, hasError: boolean): string {
  const { hintId, errorId } = fieldIds(controlId);
  return hasError ? `${hintId} ${errorId}` : hintId;
}

/**
 * Labelled field layout: label row, control, description, error line. Owns the id scheme — the
 * description, or else `trailing`, renders inside the element carrying `hintId`, so a caller never
 * attaches it by hand.
 */
export function FormField({
  controlId,
  label,
  isRequired,
  badges,
  trailing,
  description,
  error,
  children,
}: FormFieldProps): ReactElement {
  const { hintId, errorId } = fieldIds(controlId);
  const hasError = error !== undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Typography as="label" variant="caps-tiny" htmlFor={controlId} className="text-fg-3">
          {label}
        </Typography>
        {isRequired && <Chip tone="outline">required</Chip>}
        {badges}
        <span
          id={description === undefined ? hintId : undefined}
          className="ml-auto flex items-center"
        >
          {trailing}
        </span>
      </div>
      {children}
      {description !== undefined && (
        <Typography variant="meta" id={hintId} className="text-fg-4">
          {description}
        </Typography>
      )}
      {hasError && (
        <Typography variant="body-sm" id={errorId} className="text-tsh-red" role="alert">
          {error}
        </Typography>
      )}
    </div>
  );
}
