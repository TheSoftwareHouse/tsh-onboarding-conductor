import type { ReactElement } from 'react';
import { setMember } from '../form-values';
import { ValidationNumberInput } from './ValidationNumberInput';
import { readNumber, type ValidationEditorProps } from './validation-values';

export function ArrayValidation({
  value,
  onChange,
  readOnly,
}: ValidationEditorProps): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <ValidationNumberInput
        label="Minimum items"
        min={0}
        readOnly={readOnly}
        value={readNumber(value.minItems)}
        onChange={(next) => onChange(setMember(value, 'minItems', next))}
      />
      <ValidationNumberInput
        label="Maximum items"
        min={0}
        readOnly={readOnly}
        value={readNumber(value.maxItems)}
        onChange={(next) => onChange(setMember(value, 'maxItems', next))}
      />
    </div>
  );
}
