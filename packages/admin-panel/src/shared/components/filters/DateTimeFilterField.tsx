import type { ChangeEvent, ReactElement } from 'react';
import { FilterField, type FilterControlProps } from './FilterField';

export interface DateTimeFilterFieldProps extends FilterControlProps {
  /** `datetime-local` control value in the operator's own time zone, or empty. */
  value: string;
  onChange: (value: string) => void;
}

/** One bound of a time window, entered in the operator's own time zone. */
export function DateTimeFilterField({
  id,
  name,
  label,
  value,
  disabled,
  describedBy,
  invalid,
  onChange,
}: DateTimeFilterFieldProps): ReactElement {
  return (
    <FilterField controlId={id} label={label}>
      <input
        id={id}
        name={name}
        type="datetime-local"
        aria-describedby={describedBy}
        aria-invalid={invalid}
        disabled={disabled}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
    </FilterField>
  );
}
