import { useContext, useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { Typography } from '@/components/ui/Typography/Typography';
import { findConfigHint, findConfigLabel, type HintOwner } from '../../../constants/config-hints';
import {
  buildDefault,
  CONDITION_REFS,
  findRefName,
  humanize,
  isComposite,
  isEmptyValue,
  listVariants,
  readKind,
  resolveSchema,
  type Schema,
} from '../../../utils/config-schema';
import { toMemberPath } from '../../../utils/check-config';
import { useConfigFormContext } from './config-form-context';
import { findConnectorType, PrimaryConnectorContext, retypeConnector } from './connector-binding';
import { ConnectorPicker, readConnectorTypes } from './ConnectorPicker';
import { findValidationType } from './FieldValidation/FieldValidation';
import { FieldRow } from './FieldRow';
import { asObject, describeFallback, setMember } from './form-values';
import { SchemaForm } from './SchemaForm';

export interface ObjectFormProps {
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
  /** Where this object sits in the step's config. */
  path?: string;
  /** Members drawn elsewhere, such as a variant's `type` tag. */
  skip?: string[];
  /** Per-member engine defaults. */
  defaults?: Record<string, unknown>;
  /** Optional members still unset wait behind a toggle; only a section's top level does this. */
  hidesUnset?: boolean;
}

// Field descriptors are the only config objects that declare both a `type` and a `required` member.
function readHintOwner(schema: Schema, connectorTypes: string[] | null): HintOwner {
  if (connectorTypes !== null) return 'connector';
  return schema.properties?.type && schema.properties.required ? 'field' : 'config';
}

/** A member drawn as a named set of settings: a validation editor or a nested object form, not a list, map or condition. */
function isGroupMember(member: Schema, key: string): boolean {
  const refName = findRefName(member);
  if (refName !== null && CONDITION_REFS.has(refName)) return false;
  if (findValidationType(member, key) !== null) return true;
  const resolved = resolveSchema(member);
  return (
    listVariants(resolved).length === 0 &&
    readKind(resolved) === 'object' &&
    resolved.properties !== undefined
  );
}

/** Required and set members show; with `hidesUnset`, unset optional ones wait behind a toggle. */
export function ObjectForm({
  schema,
  value,
  onChange,
  readOnly,
  path = '',
  skip = [],
  defaults = {},
  hidesUnset = false,
}: ObjectFormProps): ReactElement {
  const [showUnset, setShowUnset] = useState(false);
  const { stepType, renameField } = useConfigFormContext();
  const primary = useContext(PrimaryConnectorContext);
  const object = asObject(value);
  // A connector binding's `id` names one of the engine's connectors of the binding's type; a fallback takes the primary's.
  const connectorTypes = readConnectorTypes(schema);
  const isFallback = connectorTypes !== null && primary !== null;
  const boundType =
    connectorTypes === null
      ? undefined
      : isFallback
        ? primary.type
        : findConnectorType(object, connectorTypes, stepType);
  const pickableTypes =
    connectorTypes === null ? null : boundType === undefined ? connectorTypes : [boundType];
  const hintOwner = readHintOwner(schema, connectorTypes);
  // A fallback's `type` follows the primary's, so it shows only when it disagrees.
  const hidesType = isFallback && (object.type === undefined || object.type === boundType);
  const properties = Object.entries(schema.properties ?? {}).filter(
    ([key]) => !skip.includes(key) && !(hidesType && key === 'type'),
  );
  const writeMember = (key: string, member: unknown): void =>
    onChange(
      key === 'type' && connectorTypes !== null && !isFallback
        ? retypeConnector(object, member, connectorTypes, stepType)
        : setMember(object, key, member),
    );
  const required = new Set(schema.required ?? []);
  // A member once set stays shown after it is cleared, so clearing it to retype keeps the input.
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set(Object.keys(object)));
  const newlySet = Object.keys(object).filter((key) => !revealed.has(key));
  if (newlySet.length > 0) setRevealed(new Set([...revealed, ...newlySet]));
  const isHidden = (key: string): boolean =>
    hidesUnset && !required.has(key) && !(key in object) && !revealed.has(key);
  const hiddenCount = properties.filter(([key]) => isHidden(key)).length;
  const shown = showUnset ? properties : properties.filter(([key]) => !isHidden(key));

  const form = (
    <div className="flex flex-col gap-4">
      {shown.map(([key, member]) => {
        const isOptional = !required.has(key);
        const isSet = key in object;
        const label = findConfigLabel(key) ?? humanize(key);
        const fallback = describeFallback(defaults[key]);
        const isGroup = isGroupMember(member, key);
        const setCount = Object.keys(asObject(object[key])).length;

        return (
          <FieldRow
            key={key}
            label={label}
            required={!isOptional}
            hint={findConfigHint(hintOwner, stepType, key)}
            group={
              isGroup
                ? {
                    open: !(isOptional && !isSet),
                    summary: setCount > 0 ? `· ${setCount} set` : undefined,
                  }
                : undefined
            }
            onRemove={
              readOnly || !isOptional || !isSet ? undefined : () => writeMember(key, undefined)
            }
          >
            {isOptional && !isSet && isComposite(member) ? (
              <div className="flex items-center gap-2">
                <Typography variant="meta" as="span">
                  Not set
                  {fallback ? ` · ${fallback}` : ''}
                </Typography>
                {!readOnly && (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Set ${label}`}
                    onClick={() => onChange(setMember(object, key, buildDefault(member)))}
                  >
                    Set
                  </Button>
                )}
              </div>
            ) : key === 'id' && pickableTypes !== null ? (
              <ConnectorPicker
                types={pickableTypes}
                value={object[key]}
                readOnly={readOnly}
                label={label}
                onChange={(next) => onChange(setMember(object, key, next))}
              />
            ) : (
              <SchemaForm
                schema={member}
                name={key}
                path={toMemberPath(path, key)}
                label={label}
                value={object[key]}
                readOnly={readOnly}
                optional={isOptional}
                fallback={defaults[key]}
                // Only a section's top level hides unset members, so this is the step's root field map.
                onRenameEntry={
                  hidesUnset && key === 'fields' ? (renameField ?? undefined) : undefined
                }
                onChange={(next) =>
                  writeMember(key, isOptional && isEmptyValue(next) ? undefined : next)
                }
              />
            )}
          </FieldRow>
        );
      })}
      {hiddenCount > 0 && !readOnly && (
        <Button
          variant="quiet"
          size="sm"
          className="self-start"
          onClick={() => setShowUnset(!showUnset)}
        >
          {showUnset
            ? 'Hide unset settings'
            : `Show ${hiddenCount} more ${hiddenCount === 1 ? 'setting' : 'settings'}`}
        </Button>
      )}
    </div>
  );

  return connectorTypes === null || isFallback ? (
    form
  ) : (
    <PrimaryConnectorContext.Provider value={{ type: boundType }}>
      {form}
    </PrimaryConnectorContext.Provider>
  );
}
