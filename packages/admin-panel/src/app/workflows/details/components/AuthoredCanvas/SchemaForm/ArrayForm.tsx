import type { ReactElement } from 'react';
import { Typography } from '@/components/ui/Typography/Typography';
import { buildDefault, readKind, resolveSchema, type Schema } from '../../../utils/config-schema';
import { toEntryPath } from '../../../utils/check-config';
import { Checkbox } from '../Checkbox';
import { AddButton, DeleteButton } from '../EntryActions';
import { EntryCard } from '../EntryCard';
import { EntryTitle } from '../EntryTitle';
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

/** A list's label read as one of its entries: "Connectors" → "connector", "Branches" → "branch". */
function toEntryNoun(label: string): string {
  const noun = label.toLowerCase();
  if (noun.endsWith('ies')) return `${noun.slice(0, -3)}y`;
  if (/(ch|sh|ss|x)es$/.test(noun)) return noun.slice(0, -2);
  if (noun.endsWith('s') && !noun.endsWith('ss')) return noun.slice(0, -1);
  return noun;
}

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

  return (
    <div className="flex flex-col gap-2">
      {list.map((entry, index) => {
        const entryLabel = `${label} ${index + 1}`;
        const remove = (): void => onChange(list.filter((_, at) => at !== index));
        const form = (
          <SchemaForm
            schema={schema.items ?? {}}
            path={toEntryPath(path, index)}
            label={entryLabel}
            value={entry}
            readOnly={readOnly}
            onChange={(next) =>
              onChange(list.map((current, at) => (at === index ? next : current)))
            }
          />
        );

        // Entries have no identity of their own; removing one re-keys the rest.
        return isScalar ? (
          <div key={index} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">{form}</div>
            {!readOnly && <DeleteButton label={`Remove ${entryLabel}`} onClick={remove} />}
          </div>
        ) : (
          <EntryCard
            key={index}
            header={
              <>
                <EntryTitle>
                  {toEntryNoun(label)} {index + 1}
                </EntryTitle>
                {!readOnly && <DeleteButton label={`Remove ${entryLabel}`} onClick={remove} />}
              </>
            }
          >
            {form}
          </EntryCard>
        );
      })}
      {!readOnly && (
        <AddButton onClick={() => onChange([...list, buildDefault(schema.items ?? {})])}>
          {toEntryNoun(label)}
        </AddButton>
      )}
    </div>
  );
}
