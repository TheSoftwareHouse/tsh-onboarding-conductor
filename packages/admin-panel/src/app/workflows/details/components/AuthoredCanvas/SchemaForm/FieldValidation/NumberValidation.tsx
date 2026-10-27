import type { ReactElement } from 'react';
import { FIELD_TYPE } from '@tsh/ddl-schema/workflow-contract';
import { Typography } from '@/components/ui/Typography/Typography';
import { Checkbox } from '../../Checkbox';
import { setMember } from '../form-values';
import { AllowedValues } from './AllowedValues';
import { ValidationNumberInput } from './ValidationNumberInput';
import { readNumber, type ValidationEditorProps } from './validation-values';

interface BoundProps extends ValidationEditorProps {
  label: string;
  inclusiveKey: string;
  exclusiveKey: string;
}

/** One bound: its box writes `inclusiveKey`, or `exclusiveKey` once "Inclusive" is off. */
function Bound({
  label,
  inclusiveKey,
  exclusiveKey,
  value,
  onChange,
  readOnly,
}: BoundProps): ReactElement {
  const bound = readNumber(value[inclusiveKey]) ?? readNumber(value[exclusiveKey]);
  const isInclusive = !(exclusiveKey in value);
  const write = (next: number | undefined, inclusive: boolean): void =>
    onChange(
      setMember(
        setMember(value, inclusive ? exclusiveKey : inclusiveKey, undefined),
        inclusive ? inclusiveKey : exclusiveKey,
        next,
      ),
    );

  return (
    <div className="flex flex-col gap-1.5">
      <ValidationNumberInput
        label={label}
        step="any"
        readOnly={readOnly}
        value={bound}
        onChange={(next) => write(next, isInclusive)}
      />
      <Typography variant="meta" as="label" className="flex items-center gap-1.5">
        <Checkbox
          aria-label={`${label} inclusive`}
          disabled={readOnly || bound === undefined}
          checked={isInclusive}
          onChange={(event) => write(bound, event.target.checked)}
        />
        Inclusive
      </Typography>
    </div>
  );
}

export function NumberValidation(props: ValidationEditorProps): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <Bound {...props} label="Minimum" inclusiveKey="minimum" exclusiveKey="exclusiveMinimum" />
      <Bound {...props} label="Maximum" inclusiveKey="maximum" exclusiveKey="exclusiveMaximum" />
      <AllowedValues kind={FIELD_TYPE.number} {...props} />
    </div>
  );
}
