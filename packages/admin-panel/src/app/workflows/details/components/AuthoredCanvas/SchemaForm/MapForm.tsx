import { useId, useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { Close } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input/Input';
import { Typography } from '@/components/ui/Typography/Typography';
import {
  buildDefault,
  isComposite,
  JSON_VALUE_REF,
  resolveSchema,
  toRef,
  type Schema,
} from '../../../utils/config-schema';
import { toMemberPath } from '../../../utils/check-config';
import { asObject, findEntryNameProblem, renameMember, setMember } from './form-values';
import { MapEntryName } from './MapEntryName';
import { SchemaForm } from './SchemaForm';

export interface MapFormProps {
  schema: Schema & { propertyNames?: Schema };
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
  name: string | null;
  path: string;
  /** Renames an entry across the document; returns whether references followed. */
  onRenameEntry?: (from: string, to: string) => boolean;
}

/** An object keyed by the author: field maps, connector config, field mappings. */
export function MapForm({
  schema,
  value,
  onChange,
  readOnly,
  name,
  path,
  onRenameEntry,
}: MapFormProps): ReactElement {
  const object = asObject(value);
  const newKeyErrorId = useId();
  const [newKey, setNewKey] = useState('');
  const [newKeyProblem, setNewKeyProblem] = useState<string | null>(null);
  // The renamed entry whose references stayed behind, because another step declares the same name.
  const [unresolvedKey, setUnresolvedKey] = useState<string | null>(null);
  const member: Schema =
    typeof schema.additionalProperties === 'object'
      ? schema.additionalProperties
      : { $ref: toRef(JSON_VALUE_REF) };
  // In a field mapping each value names a workflow field.
  const isFields = name === 'fields';
  const nameLabel = isFields ? 'Field name' : 'Name';
  const pattern = schema.propertyNames ? resolveSchema(schema.propertyNames).pattern : undefined;
  const valueName = name === 'fieldMapping' ? 'field' : null;
  // An object value draws its own labelled rows; a single control needs a label of its own.
  const labelsValue = !isComposite(member);

  const rename = (from: string, to: string): void => {
    if (onRenameEntry === undefined) return onChange(renameMember(object, from, to));
    setUnresolvedKey(onRenameEntry(from, to) ? null : to);
  };

  return (
    <div className="flex flex-col gap-2 border-l-2 border-border-rule pl-3">
      {Object.entries(object).map(([key, entry]) => (
        <div key={key} className="flex flex-col gap-3 border border-border-rule bg-bg-subtle p-3">
          <MapEntryName
            name={key}
            label={nameLabel}
            taken={Object.keys(object).filter((other) => other !== key)}
            pattern={pattern}
            readOnly={readOnly}
            note={
              key === unresolvedKey
                ? 'References not updated: another step has a field with this name'
                : undefined
            }
            onRename={(next) => rename(key, next)}
            trailing={
              !readOnly && (
                <Button
                  variant="quiet"
                  size="sm"
                  className="h-9 px-2"
                  aria-label={`Remove ${key}`}
                  onClick={() => onChange(setMember(object, key, undefined))}
                >
                  <Close aria-hidden className="size-4" />
                </Button>
              )
            }
          />
          <div className="flex flex-col gap-1.5">
            {labelsValue && (
              <Typography variant="caps-tiny" as="span" aria-hidden className="text-fg-1">
                Value
              </Typography>
            )}
            <SchemaForm
              schema={member}
              name={valueName}
              path={toMemberPath(path, key)}
              label={labelsValue ? `${key} value` : key}
              value={entry}
              readOnly={readOnly}
              onChange={(next) => onChange(setMember(object, key, next))}
            />
          </div>
        </div>
      ))}
      {!readOnly && (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const problem = findEntryNameProblem(nameLabel, newKey, Object.keys(object), pattern);
            setNewKeyProblem(problem);
            if (problem !== null) return;
            onChange(setMember(object, newKey, buildDefault(member)));
            setNewKey('');
          }}
        >
          <div className="flex gap-2">
            <Input
              font="mono"
              size="sm"
              aria-label={isFields ? 'New field name' : 'New name'}
              aria-invalid={newKeyProblem !== null || undefined}
              aria-describedby={newKeyProblem !== null ? newKeyErrorId : undefined}
              placeholder={isFields ? 'New field name' : 'New name'}
              value={newKey}
              onChange={(event) => {
                setNewKey(event.target.value);
                setNewKeyProblem(null);
              }}
            />
            <Button type="submit" size="md">
              Add
            </Button>
          </div>
          {newKeyProblem !== null && (
            <Typography id={newKeyErrorId} variant="meta" role="alert" className="text-tsh-red">
              {newKeyProblem}
            </Typography>
          )}
        </form>
      )}
    </div>
  );
}
