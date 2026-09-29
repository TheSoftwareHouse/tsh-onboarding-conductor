import type { ChangeEvent, ReactElement, ReactNode } from 'react';
import { FilterField, type FilterControlProps } from '../FilterField';

export interface CheckboxFilterFieldProps extends FilterControlProps {
  value: boolean;
  onChange: (value: boolean) => void;
  /** Text beside the checkbox, since a lone checkbox carries no visible label of its own. */
  children: ReactNode;
}

/** Boolean criterion: the label-above layout of `FilterField`, with a checkbox and inline text. */
export function CheckboxFilterField({
  id,
  name,
  label,
  value,
  disabled,
  describedBy,
  invalid,
  onChange,
  children,
}: CheckboxFilterFieldProps): ReactElement {
  return (
    <FilterField controlId={id} label={label}>
      <label className="flex h-10 cursor-pointer items-center gap-2 text-body-sm text-fg-1 has-disabled:cursor-not-allowed has-disabled:text-fg-disabled">
        <input
          id={id}
          name={name}
          type="checkbox"
          className="size-4 accent-tsh-black"
          aria-describedby={describedBy}
          aria-invalid={invalid}
          disabled={disabled}
          checked={value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)}
        />
        {children}
      </label>
    </FilterField>
  );
}
