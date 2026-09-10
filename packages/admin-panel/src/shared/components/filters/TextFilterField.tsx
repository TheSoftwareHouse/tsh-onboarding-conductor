import type { ChangeEvent, ReactElement } from 'react';
import { FilterField, filterControl, type FilterControlProps } from './FilterField';

export interface TextFilterFieldProps extends FilterControlProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Longest value the endpoint accepts, so an over-long entry is caught by the input rather than
   * by a 400 response.
   */
  maxLength?: number;
  /** Keyboard hint for a criterion that only takes digits, such as a version. */
  inputMode?: 'numeric';
}

/** Free-text criterion: an identifier, a name, or any other value matched as typed. */
export function TextFilterField({
  id,
  name,
  label,
  value,
  disabled,
  describedBy,
  invalid,
  onChange,
  maxLength,
  inputMode,
}: TextFilterFieldProps): ReactElement {
  return (
    <FilterField controlId={id} label={label}>
      <input
        id={id}
        name={name}
        type="text"
        autoComplete="off"
        inputMode={inputMode}
        maxLength={maxLength}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        disabled={disabled}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        className={filterControl()}
      />
    </FilterField>
  );
}
