import type { ReactElement } from 'react';
import { Input } from '@/components/ui/Input/Input';
import { FieldRow } from '../FieldRow';
import { parseNumberInput } from '../form-values';

export interface ValidationNumberInputProps {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  readOnly: boolean;
  min?: number;
  step?: number | 'any';
}

/** A labelled number box; clearing it unsets the key. */
export function ValidationNumberInput({
  label,
  value,
  onChange,
  readOnly,
  min,
  step,
}: ValidationNumberInputProps): ReactElement {
  return (
    <FieldRow label={label} required={false}>
      <Input
        type="number"
        size="sm"
        aria-label={label}
        disabled={readOnly}
        min={min}
        step={step}
        value={value ?? ''}
        onChange={(event) => onChange(parseNumberInput(event.target.value))}
      />
    </FieldRow>
  );
}
