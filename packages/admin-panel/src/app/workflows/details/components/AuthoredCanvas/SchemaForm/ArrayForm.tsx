import type { ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { Add, Close } from '@/components/ui/icons';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';
import { buildDefault, readKind, resolveSchema, type Schema } from '../../../utils/config-schema';
import { toEntryPath } from '../../../utils/check-config';
import { Checkbox } from '../Checkbox';
import { SchemaForm } from './SchemaForm';

export interface ArrayFormProps {
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
  path: string;
  label: string;
}

const SCALAR_KINDS = ['string', 'number', 'boolean'];

/** A list: checkboxes for a closed set of options, otherwise one form per entry. */
export function ArrayForm({
  schema,
  value,
  onChange,
  readOnly,
  path,
  label,
}: ArrayFormProps): ReactElement {
  const list = Array.isArray(value) ? value : [];
  const item = resolveSchema(schema.items ?? {});

  if (item.enum !== undefined) {
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {item.enum.map((option) => (
          <Typography
            key={String(option)}
            variant="mono"
            as="label"
            className="flex items-center gap-1.5 text-fg-4"
          >
            <Checkbox
              disabled={readOnly}
              checked={list.includes(option)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...list, option]
                    : list.filter((entry) => entry !== option),
                )
              }
            />
            {String(option)}
          </Typography>
        ))}
      </div>
    );
  }

  const isScalar = SCALAR_KINDS.includes(readKind(item));
  const remove = (index: number): void => onChange(list.filter((_, at) => at !== index));

  return (
    <div className="flex flex-col gap-2">
      {list.map((entry, index) => (
        <div
          // Entries have no identity of their own; removing one re-keys the rest.
          key={index}
          className={cn(
            'flex gap-2',
            isScalar ? 'items-center' : 'flex-col border-l-2 border-border-rule pl-3',
          )}
        >
          {!isScalar && (
            <div className="flex items-center justify-between">
              <Typography variant="meta" as="span">
                #{index + 1}
              </Typography>
              {!readOnly && <RemoveEntry label={label} index={index} onRemove={remove} />}
            </div>
          )}
          <div className={cn(isScalar && 'min-w-0 flex-1')}>
            <SchemaForm
              schema={schema.items ?? {}}
              path={toEntryPath(path, index)}
              label={`${label} ${index + 1}`}
              value={entry}
              readOnly={readOnly}
              onChange={(next) =>
                onChange(list.map((current, at) => (at === index ? next : current)))
              }
            />
          </div>
          {isScalar && !readOnly && <RemoveEntry label={label} index={index} onRemove={remove} />}
        </div>
      ))}
      {!readOnly && (
        <Button
          size="sm"
          className="self-start"
          aria-label={`Add ${label}`}
          onClick={() => onChange([...list, buildDefault(schema.items ?? {})])}
        >
          <Add aria-hidden className="size-4" />
          Add
        </Button>
      )}
    </div>
  );
}

function RemoveEntry({
  label,
  index,
  onRemove,
}: {
  label: string;
  index: number;
  onRemove: (index: number) => void;
}): ReactElement {
  return (
    <Button
      variant="quiet"
      size="sm"
      className="h-6 px-1"
      aria-label={`Remove ${label} ${index + 1}`}
      onClick={() => onRemove(index)}
    >
      <Close aria-hidden className="size-4" />
    </Button>
  );
}
