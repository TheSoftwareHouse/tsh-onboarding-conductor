import { useId, type ReactElement } from 'react';
import { FIELD_TYPE } from '@tsh/ddl-schema/workflow-contract';
import { Input } from '@/components/ui/Input/Input';
import { Select } from '@/components/ui/Select/Select';
import { Typography } from '@/components/ui/Typography/Typography';
import { resolveSchema, toRef } from '../../../../utils/config-schema';
import { FieldRow } from '../FieldRow';
import { setMember } from '../form-values';
import { AllowedValues } from './AllowedValues';
import { ValidationNumberInput } from './ValidationNumberInput';
import { ANY, readNumber, type ValidationEditorProps } from './validation-values';

function readFormats(): string[] {
  const format = resolveSchema({ $ref: toRef('textValidation') }).properties?.format;
  return (format?.enum ?? []).filter((name): name is string => typeof name === 'string');
}

function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export function TextValidation({ value, onChange, readOnly }: ValidationEditorProps): ReactElement {
  const patternErrorId = useId();
  const pattern = typeof value.pattern === 'string' ? value.pattern : '';
  const items = [
    { value: ANY, label: 'Any format' },
    ...readFormats().map((name) => ({ value: name, label: name })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <ValidationNumberInput
        label="Minimum length"
        min={0}
        readOnly={readOnly}
        value={readNumber(value.minLength)}
        onChange={(next) => onChange(setMember(value, 'minLength', next))}
      />
      <ValidationNumberInput
        label="Maximum length"
        min={0}
        readOnly={readOnly}
        value={readNumber(value.maxLength)}
        onChange={(next) => onChange(setMember(value, 'maxLength', next))}
      />
      <FieldRow label="Pattern" required={false}>
        <Input
          font="mono"
          size="sm"
          aria-label="Pattern"
          aria-invalid={!isValidPattern(pattern)}
          aria-describedby={isValidPattern(pattern) ? undefined : patternErrorId}
          disabled={readOnly}
          value={pattern}
          onChange={(event) =>
            onChange(
              setMember(
                value,
                'pattern',
                event.target.value === '' ? undefined : event.target.value,
              ),
            )
          }
        />
        {!isValidPattern(pattern) && (
          <Typography
            id={patternErrorId}
            variant="meta"
            as="p"
            role="alert"
            className="text-tsh-red"
          >
            Not a valid pattern
          </Typography>
        )}
      </FieldRow>
      <FieldRow label="Format" required={false}>
        <Select
          aria-label="Format"
          items={items}
          value={typeof value.format === 'string' ? value.format : ANY}
          disabled={readOnly}
          onValueChange={(next) =>
            onChange(setMember(value, 'format', next === ANY ? undefined : next))
          }
        />
      </FieldRow>
      <AllowedValues kind={FIELD_TYPE.text} value={value} onChange={onChange} readOnly={readOnly} />
    </div>
  );
}
