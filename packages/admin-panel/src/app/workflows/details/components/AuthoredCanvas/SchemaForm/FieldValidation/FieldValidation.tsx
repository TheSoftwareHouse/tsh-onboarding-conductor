import type { ComponentType, ReactElement } from 'react';
import { FIELD_TYPE } from '@tsh/ddl-schema/workflow-contract';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';
import { findRefName, type Schema } from '../../../../utils/config-schema';
import { asObject } from '../form-values';
import { ArrayValidation } from './ArrayValidation';
import { BooleanValidation } from './BooleanValidation';
import { DateValidation } from './DateValidation';
import { FileValidation } from './FileValidation';
import { NumberValidation } from './NumberValidation';
import { TextValidation } from './TextValidation';
import type { ValidationEditorProps } from './validation-values';

function NoValidation(): ReactElement {
  return (
    <Typography variant="meta" as="p">
      No validation for this type
    </Typography>
  );
}

const EDITORS: Record<string, ComponentType<ValidationEditorProps>> = {
  [FIELD_TYPE.text]: TextValidation,
  [FIELD_TYPE.number]: NumberValidation,
  [FIELD_TYPE.boolean]: BooleanValidation,
  [FIELD_TYPE.date]: DateValidation,
  [FIELD_TYPE.file]: FileValidation,
  [FIELD_TYPE.array]: ArrayValidation,
  [FIELD_TYPE.object]: NoValidation,
};

const REF_SUFFIX = 'Validation';

/** The field type a validation schema belongs to: `#/definitions/<type>Validation`, or file's inline object. */
export function findValidationType(schema: Schema, name: string | null): string | null {
  const refName = findRefName(schema);
  if (refName?.endsWith(REF_SUFFIX)) {
    const type = refName.slice(0, -REF_SUFFIX.length);
    return type in EDITORS ? type : null;
  }
  return name === 'validation' && schema.properties?.contentTypes !== undefined
    ? FIELD_TYPE.file
    : null;
}

export interface FieldValidationProps {
  type: string;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
  framed?: boolean;
}

/** The editor for one field type's `validation`, writing only the keys that type allows. */
export function FieldValidation({
  type,
  value,
  onChange,
  readOnly,
  framed = false,
}: FieldValidationProps): ReactElement {
  const Editor = EDITORS[type] ?? NoValidation;
  return (
    <div className={cn(framed && 'border-l-2 border-border-rule pl-3')}>
      <Editor value={asObject(value)} onChange={onChange} readOnly={readOnly} />
    </div>
  );
}
