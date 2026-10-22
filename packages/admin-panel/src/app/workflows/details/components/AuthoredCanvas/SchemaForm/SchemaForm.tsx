// PoC (throwaway): a form drawn from a step type's config schema. Controlled by the document: every
// change is written straight back, so the canvas, the field list and the JSON tab stay in step.
import { useState, type ReactElement, type ReactNode } from 'react';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';
import { ConditionEditor } from './ConditionEditor';
import { CountryPicker, isCountrySchema } from './CountryPicker';
import {
  buildDefault,
  CONDITION_REFS,
  FIELD_NAMES_LIST_ID,
  findRefName,
  humanize,
  isComposite,
  isEmptyValue,
  isFieldReference,
  listVariants,
  pickVariant,
  readDiscriminator,
  readKind,
  resolveSchema,
  type Schema,
} from './schema-utils';

export interface SchemaFormProps {
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
  /** The member name this value sits under, used for its label and to spot field references. */
  name?: string | null;
  /** An optional value can be left unset, which an input shows as empty. */
  optional?: boolean;
  /** What the engine uses while the value is unset. */
  fallback?: unknown;
  /** Per-member engine defaults, for the object this form draws. */
  defaults?: Record<string, unknown>;
  /**
   * A member of another object: it gets a left rule, so its end is visible. Map and list entries are
   * framed by their own container, so they are never framed twice.
   */
  framed?: boolean;
}

/** The option value standing for "not set" in a select. */
const UNSET = '';

/** A scalar engine default as placeholder text, e.g. `default: documentType`. */
function describeFallback(fallback: unknown): string | undefined {
  if (typeof fallback === 'string') return `default: ${fallback}`;
  if (typeof fallback === 'number') return `default: ${fallback}`;
  if (typeof fallback === 'boolean') return `default: ${fallback ? 'yes' : 'no'}`;
  return undefined;
}

const INPUT =
  'w-full border border-border-strong bg-tsh-white px-2 py-1 text-body-sm disabled:bg-bg-subtle';

export function SchemaForm({
  schema,
  value,
  onChange,
  readOnly,
  name = null,
  optional = false,
  fallback,
  defaults = {},
  framed = false,
}: SchemaFormProps): ReactElement {
  const placeholder = describeFallback(fallback);
  const refName = findRefName(schema);
  if (refName !== null && CONDITION_REFS.has(refName)) {
    return <ConditionEditor value={value} onChange={onChange} readOnly={readOnly} />;
  }
  if (refName === 'jsonValue') {
    return <JsonValueInput value={value} onChange={onChange} readOnly={readOnly} />;
  }

  if (isCountrySchema(schema)) {
    return <CountryPicker schema={schema} value={value} onChange={onChange} readOnly={readOnly} />;
  }

  const resolved = resolveSchema(schema);
  const variants = listVariants(resolved);
  if (variants.length > 0) {
    return (
      <VariantForm
        variants={variants}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        name={name}
      />
    );
  }

  switch (readKind(resolved)) {
    case 'enum': {
      const options = resolved.enum ?? [resolved.const];
      return (
        <select
          className={INPUT}
          disabled={readOnly}
          value={value === undefined ? UNSET : JSON.stringify(value)}
          onChange={(event) =>
            onChange(event.target.value === UNSET ? undefined : JSON.parse(event.target.value))
          }
        >
          {(optional || value === undefined) && (
            <option value={UNSET}>{placeholder ? `— (${placeholder})` : '—'}</option>
          )}
          {options.map((option) => (
            <option key={String(option)} value={JSON.stringify(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      );
    }
    case 'boolean':
      return optional ? (
        <select
          className={INPUT}
          disabled={readOnly}
          value={typeof value === 'boolean' ? String(value) : UNSET}
          onChange={(event) =>
            onChange(event.target.value === UNSET ? undefined : event.target.value === 'true')
          }
        >
          <option value={UNSET}>{placeholder ? `— (${placeholder})` : '—'}</option>
          <option value="true">yes</option>
          <option value="false">no</option>
        </select>
      ) : (
        <input
          type="checkbox"
          className="size-4 self-start"
          disabled={readOnly}
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          className={INPUT}
          disabled={readOnly}
          min={resolved.minimum}
          max={resolved.maximum}
          placeholder={placeholder}
          value={typeof value === 'number' ? value : ''}
          onChange={(event) =>
            onChange(event.target.value === '' ? undefined : Number(event.target.value))
          }
        />
      );
    case 'string':
      return (
        <input
          className={cn(INPUT, 'font-mono')}
          disabled={readOnly}
          list={isFieldReference(name) ? FIELD_NAMES_LIST_ID : undefined}
          placeholder={
            placeholder ?? (resolved.pattern ? `pattern ${resolved.pattern}` : undefined)
          }
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'array':
      return <ArrayForm schema={resolved} value={value} onChange={onChange} readOnly={readOnly} />;
    case 'object':
      return resolved.properties ? (
        <ObjectForm
          schema={resolved}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          defaults={defaults}
          framed={framed}
        />
      ) : (
        <MapForm
          schema={resolved}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          name={name}
        />
      );
    default:
      return <JsonValueInput value={value} onChange={onChange} readOnly={readOnly} />;
  }
}

function Row({
  label,
  required,
  onRemove,
  children,
}: {
  label: string;
  required: boolean;
  onRemove?: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Typography variant="meta" as="span" className="font-medium text-fg-1">
          {label}
          {required && <span className="text-tsh-red"> *</span>}
        </Typography>
        {onRemove && (
          <button
            type="button"
            className="cursor-pointer px-1 text-fg-4 hover:text-tsh-red"
            onClick={onRemove}
            aria-label={`Remove ${label}`}
          >
            ×
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function setMember(
  object: Record<string, unknown>,
  key: string,
  member: unknown,
): Record<string, unknown> {
  const next = { ...object };
  if (member === undefined) delete next[key];
  else next[key] = member;
  return next;
}

/**
 * Required members and set ones show; optional ones still unset wait behind a toggle, kept in schema
 * order so a member never moves when it gets a value. An optional one left empty is unset, and an
 * unset object or variant starts from a "Set" button.
 */
function ObjectForm({
  schema,
  value,
  onChange,
  readOnly,
  skip = [],
  defaults = {},
  framed = false,
}: {
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
  skip?: string[];
  defaults?: Record<string, unknown>;
  framed?: boolean;
}): ReactElement {
  const [showUnset, setShowUnset] = useState(false);
  const object = asObject(value);
  const properties = Object.entries(schema.properties ?? {}).filter(([key]) => !skip.includes(key));
  const required = new Set(schema.required ?? []);
  const isHidden = (key: string): boolean => !required.has(key) && !(key in object);
  const hiddenCount = properties.filter(([key]) => isHidden(key)).length;
  const shown = showUnset ? properties : properties.filter(([key]) => !isHidden(key));

  return (
    <div className={cn('flex flex-col gap-4', framed && 'border-l-2 border-border-rule pl-3')}>
      {shown.map(([key, member]) => {
        const isOptional = !required.has(key);
        const isSet = key in object;
        return (
          <Row
            key={key}
            label={humanize(key)}
            required={!isOptional}
            onRemove={
              readOnly || !isOptional || !isSet
                ? undefined
                : () => onChange(setMember(object, key, undefined))
            }
          >
            {isOptional && !isSet && isComposite(member) ? (
              <div className="flex items-center gap-2">
                <Typography variant="meta" as="span" className="text-fg-disabled">
                  not set
                  {describeFallback(defaults[key]) ? ` · ${describeFallback(defaults[key])}` : ''}
                </Typography>
                {!readOnly && (
                  <button
                    type="button"
                    className="cursor-pointer border border-dashed border-border-strong px-2 text-caption text-fg-3"
                    onClick={() => onChange(setMember(object, key, buildDefault(member)))}
                  >
                    Set
                  </button>
                )}
              </div>
            ) : (
              <SchemaForm
                schema={member}
                name={key}
                value={object[key]}
                readOnly={readOnly}
                optional={isOptional}
                fallback={defaults[key]}
                framed
                onChange={(next) =>
                  onChange(
                    setMember(object, key, isOptional && isEmptyValue(next) ? undefined : next),
                  )
                }
              />
            )}
          </Row>
        );
      })}
      {hiddenCount > 0 && !readOnly && (
        <button
          type="button"
          className="cursor-pointer self-start text-caption text-fg-3 underline hover:text-fg-1"
          onClick={() => setShowUnset(!showUnset)}
        >
          {showUnset
            ? 'Hide unset settings'
            : `Show ${hiddenCount} more ${hiddenCount === 1 ? 'setting' : 'settings'}`}
        </button>
      )}
    </div>
  );
}

/** An object keyed by the author: field maps, connector config, field mappings. */
function MapForm({
  schema,
  value,
  onChange,
  readOnly,
  name,
}: {
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
  name: string | null;
}): ReactElement {
  const object = asObject(value);
  const [newKey, setNewKey] = useState('');
  const member: Schema =
    typeof schema.additionalProperties === 'object'
      ? schema.additionalProperties
      : { $ref: '#/definitions/jsonValue' };
  // In a field mapping each value names a workflow field.
  const valueName = name === 'fieldMapping' ? 'field' : null;

  return (
    <div className="flex flex-col gap-2 border-l-2 border-border-rule pl-3">
      {Object.entries(object).map(([key, entry]) => (
        <Row
          key={key}
          label={key}
          required={false}
          onRemove={readOnly ? undefined : () => onChange(setMember(object, key, undefined))}
        >
          <SchemaForm
            schema={member}
            name={valueName}
            value={entry}
            readOnly={readOnly}
            onChange={(next) => onChange(setMember(object, key, next))}
          />
        </Row>
      ))}
      {!readOnly && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (newKey === '' || newKey in object) return;
            onChange({ ...object, [newKey]: buildDefault(member) });
            setNewKey('');
          }}
        >
          <input
            className={cn(INPUT, 'font-mono')}
            placeholder="new key"
            value={newKey}
            onChange={(event) => setNewKey(event.target.value)}
          />
          <button
            type="submit"
            className="cursor-pointer border border-border-strong px-2 text-caption"
          >
            Add
          </button>
        </form>
      )}
    </div>
  );
}

function ArrayForm({
  schema,
  value,
  onChange,
  readOnly,
}: {
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
}): ReactElement {
  const list = Array.isArray(value) ? value : [];
  const item = resolveSchema(schema.items ?? {});

  // A closed set of options: checkboxes.
  if (item.enum !== undefined) {
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {item.enum.map((option) => (
          <label key={String(option)} className="flex items-center gap-1.5">
            <input
              type="checkbox"
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
            <Typography variant="meta" as="span" className="font-mono">
              {String(option)}
            </Typography>
          </label>
        ))}
      </div>
    );
  }

  const isScalar = ['string', 'number', 'boolean'].includes(readKind(item));

  return (
    <div className="flex flex-col gap-2">
      {list.map((entry, index) => (
        <div
          key={index}
          className={cn(
            'flex gap-2',
            isScalar ? 'items-center' : 'flex-col border-l-2 border-border-rule pl-3',
          )}
        >
          {!isScalar && (
            <div className="flex justify-between">
              <Typography variant="meta" as="span">
                #{index + 1}
              </Typography>
              {!readOnly && (
                <RemoveButton onClick={() => onChange(list.filter((_, at) => at !== index))} />
              )}
            </div>
          )}
          <SchemaForm
            schema={schema.items ?? {}}
            value={entry}
            readOnly={readOnly}
            onChange={(next) =>
              onChange(list.map((current, at) => (at === index ? next : current)))
            }
          />
          {isScalar && !readOnly && (
            <RemoveButton onClick={() => onChange(list.filter((_, at) => at !== index))} />
          )}
        </div>
      ))}
      {!readOnly && (
        <button
          type="button"
          className="cursor-pointer self-start border border-dashed border-border-strong px-2 py-1 text-caption text-fg-3"
          onClick={() => onChange([...list, buildDefault(schema.items ?? {})])}
        >
          + Add
        </button>
      )}
    </div>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      className="cursor-pointer px-1 text-fg-4 hover:text-tsh-red"
      onClick={onClick}
      aria-label="Remove"
    >
      ×
    </button>
  );
}

const KIND_LABELS: Record<string, string> = {
  enum: 'preset',
  array: 'list',
  string: 'text',
  number: 'number',
  boolean: 'yes / no',
  object: 'custom',
};

/** `anyOf`: a tag select for tagged objects (field descriptors), otherwise one tab per shape. */
function VariantForm({
  variants,
  value,
  onChange,
  readOnly,
  name,
}: {
  variants: Schema[];
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
  name: string | null;
}): ReactElement {
  const index = pickVariant(variants, value);
  const tags = readDiscriminator(variants);

  if (tags) {
    return (
      <div className="flex flex-col gap-4">
        <Row label="Type" required>
          <select
            className={INPUT}
            disabled={readOnly}
            value={tags[index]}
            onChange={(event) => {
              const next = variants[tags.indexOf(event.target.value)];
              onChange({ ...asObject(buildDefault(next)), type: event.target.value });
            }}
          >
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </Row>
        <ObjectForm
          schema={variants[index]}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          skip={['type']}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        {variants.map((variant, at) => (
          <button
            key={at}
            type="button"
            disabled={readOnly}
            className={cn(
              'cursor-pointer border px-2 py-0.5 text-caption',
              at === index
                ? 'border-tsh-black bg-tsh-black text-tsh-white'
                : 'border-border-strong text-fg-3',
            )}
            onClick={() => at !== index && onChange(buildDefault(variant))}
          >
            {KIND_LABELS[readKind(variant)] ?? `option ${at + 1}`}
          </button>
        ))}
      </div>
      <SchemaForm
        schema={variants[index]}
        name={name}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
      />
    </div>
  );
}

/** Free-form JSON values (connector config): plain text for strings, JSON for anything else. */
function JsonValueInput({
  value,
  onChange,
  readOnly,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
}): ReactElement {
  const [draft, setDraft] = useState(typeof value === 'string' ? value : JSON.stringify(value));
  return (
    <input
      className={cn(INPUT, 'font-mono')}
      disabled={readOnly}
      value={draft}
      title="Text, or JSON for numbers, booleans, lists and objects"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        try {
          onChange(JSON.parse(draft));
        } catch {
          onChange(draft);
        }
      }}
    />
  );
}
