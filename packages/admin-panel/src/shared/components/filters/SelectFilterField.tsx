import type { ChangeEvent, ReactElement } from 'react';
import { FilterField, filterControl, type FilterControlProps } from './FilterField';

export interface FilterOption {
  value: string;
  label: string;
}

export interface SelectFilterFieldProps extends FilterControlProps {
  value: string;
  options: readonly FilterOption[];
  onChange: (value: string) => void;
  /**
   * Label for the empty value that disables the criterion. Omitted for a select that always
   * narrows, such as the page size.
   */
  anyOptionLabel?: string;
}

/** Criterion picked from the closed set of values the engine defines for it. */
export function SelectFilterField({
  id,
  name,
  label,
  value,
  options,
  disabled,
  describedBy,
  invalid,
  onChange,
  anyOptionLabel,
}: SelectFilterFieldProps): ReactElement {
  return (
    <FilterField controlId={id} label={label}>
      <select
        id={id}
        name={name}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        disabled={disabled}
        value={value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
        className={filterControl()}
      >
        {anyOptionLabel !== undefined && <option value="">{anyOptionLabel}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FilterField>
  );
}

/**
 * Builds the option list for a criterion drawn from an engine-defined literal union, labelling
 * every value with the same describe function the table cells use.
 */
export function toFilterOptions<TValue extends string>(
  values: readonly TValue[],
  describe: (value: TValue) => string,
): FilterOption[] {
  return values.map((value) => ({ value, label: describe(value) }));
}
