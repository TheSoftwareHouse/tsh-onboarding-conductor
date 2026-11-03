import type { ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { Select } from '@/components/ui/Select/Select';
import {
  buildDefault,
  listVariants,
  pickVariant,
  readDiscriminator,
  readKind,
  type Kind,
  type Schema,
} from '../../../utils/config-schema';
import { ConfigFormContext, useConfigFormContext } from './config-form-context';
import { FieldRow } from './FieldRow';
import { asObject } from './form-values';
import { ObjectForm } from './ObjectForm';
import { SchemaForm } from './SchemaForm';

export interface VariantFormProps {
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
  name: string | null;
  path: string;
  label: string;
}

const KIND_LABELS: Partial<Record<Kind, string>> = {
  enum: 'preset',
  array: 'list',
  string: 'text',
  number: 'number',
  boolean: 'yes / no',
  object: 'custom',
};

function omitKey<T extends object>(record: T, key: string): T {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key)) as T;
}

/** `anyOf`: a tag select for tagged objects (field descriptors), otherwise one button per shape. */
export function VariantForm({
  schema,
  value,
  onChange,
  readOnly,
  name,
  path,
  label,
}: VariantFormProps): ReactElement {
  const variants = listVariants(schema);
  const index = pickVariant(variants, value);
  const tags = readDiscriminator(variants);
  const context = useConfigFormContext();

  if (tags) {
    return (
      <div className="flex flex-col gap-4">
        <FieldRow label="Type" required>
          <Select
            aria-label={`${label} type`}
            items={tags.map((tag) => ({ value: tag, label: tag }))}
            value={tags[index]}
            disabled={readOnly}
            onValueChange={(tag) =>
              onChange({ ...asObject(buildDefault(variants[tags.indexOf(tag)])), type: tag })
            }
          />
        </FieldRow>
        <ObjectForm
          schema={variants[index]}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          path={path}
          skip={['type']}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        {variants.map((variant, at) => (
          <Button
            key={at}
            size="sm"
            variant={at === index ? 'primary' : 'secondary'}
            aria-pressed={at === index}
            disabled={readOnly}
            onClick={() => at !== index && onChange(buildDefault(variant))}
          >
            {KIND_LABELS[readKind(variant)] ?? `option ${at + 1}`}
          </Button>
        ))}
      </div>
      {/* The outer SchemaForm shows this path's reason; the inner one keeps the path for its children only. */}
      <ConfigFormContext.Provider value={{ ...context, failures: omitKey(context.failures, path) }}>
        <SchemaForm
          schema={variants[index]}
          name={name}
          path={path}
          label={label}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
        />
      </ConfigFormContext.Provider>
    </div>
  );
}
