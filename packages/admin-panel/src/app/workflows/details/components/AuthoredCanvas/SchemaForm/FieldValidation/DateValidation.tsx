import type { ReactElement } from 'react';
import { FIELD_TYPE } from '@tsh/ddl-schema/workflow-contract';
import { setMember } from '../form-values';
import { AllowedValues } from './AllowedValues';
import { ValidationNumberInput } from './ValidationNumberInput';
import { readNumber, type ValidationEditorProps } from './validation-values';

export function DateValidation({ value, onChange, readOnly }: ValidationEditorProps): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <ValidationNumberInput
        label="Minimum age (years)"
        min={0}
        readOnly={readOnly}
        value={readNumber(value.minAgeYears)}
        onChange={(next) => onChange(setMember(value, 'minAgeYears', next))}
      />
      <ValidationNumberInput
        label="Maximum age (years)"
        min={0}
        readOnly={readOnly}
        value={readNumber(value.maxAgeYears)}
        onChange={(next) => onChange(setMember(value, 'maxAgeYears', next))}
      />
      <AllowedValues kind={FIELD_TYPE.date} value={value} onChange={onChange} readOnly={readOnly} />
    </div>
  );
}
