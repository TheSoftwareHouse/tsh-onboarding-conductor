import type { ReactElement } from 'react';
import { FieldRow } from '../FieldRow';
import { Select } from '@/components/ui/Select/Select';
import { setMember } from '../form-values';
import { ANY, type ValidationEditorProps } from './validation-values';

const ITEMS = [
  { value: ANY, label: 'Any value' },
  { value: 'true', label: 'Must be true' },
  { value: 'false', label: 'Must be false' },
];

function readChoice(value: Record<string, unknown>): string {
  const list = value.oneOf;
  return Array.isArray(list) && list.length === 1 && typeof list[0] === 'boolean'
    ? String(list[0])
    : ANY;
}

export function BooleanValidation({
  value,
  onChange,
  readOnly,
}: ValidationEditorProps): ReactElement {
  return (
    <FieldRow label="Allowed value" required={false}>
      <Select
        aria-label="Allowed value"
        items={ITEMS}
        value={readChoice(value)}
        disabled={readOnly}
        onValueChange={(next) =>
          onChange(setMember(value, 'oneOf', next === ANY ? undefined : [next === 'true']))
        }
      />
    </FieldRow>
  );
}
