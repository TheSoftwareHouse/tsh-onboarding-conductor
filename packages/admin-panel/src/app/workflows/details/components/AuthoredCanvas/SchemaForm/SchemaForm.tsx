import { useId, type ReactElement } from 'react';
import { Input } from '@/components/ui/Input/Input';
import { Select } from '@/components/ui/Select/Select';
import { Typography } from '@/components/ui/Typography/Typography';
import {
  CONDITION_REFS,
  JSON_VALUE_REF,
  FIELD_NAMES_LIST_ID,
  findRefName,
  isFieldReference,
  listVariants,
  readKind,
  resolveSchema,
  type Schema,
} from '../../../utils/config-schema';
import { ArrayForm } from './ArrayForm';
import { Checkbox } from '../Checkbox';
import { useConfigFormContext } from './config-form-context';
import { ConditionEditor } from './ConditionEditor';
import { CountryPicker, isCountrySchema } from './CountryPicker';
import { FieldValidation, findValidationType } from './FieldValidation/FieldValidation';
import { describeFallback, UNSET } from './form-values';
import { JsonValueInput } from './JsonValueInput';
import { MapForm } from './MapForm';
import { ObjectForm } from './ObjectForm';
import { VariantForm } from './VariantForm';

export interface SchemaFormProps {
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
  /** The member name this value sits under, used to spot field references. */
  name?: string | null;
  /** Where this value sits in the step's config, as `check-config` paths it; a failure there shows under it. */
  path?: string;
  /** Names the control for assistive technology. */
  label?: string;
  /** An optional value can be left unset, which an input shows as empty. */
  optional?: boolean;
  /** What the engine uses while the value is unset. */
  fallback?: unknown;
  /** Per-member engine defaults, for the object this form draws. */
  defaults?: Record<string, unknown>;
  /** A member of another object: it gets a left rule. Map and list entries are never framed twice. */
  framed?: boolean;
  /** Optional members still unset wait behind a toggle; only a section's top level does this. */
  hidesUnset?: boolean;
  /** Renames a map entry across the document, in place of a plain key rename; returns whether references followed. */
  onRenameEntry?: (from: string, to: string) => boolean;
}

const BOOLEAN_ITEMS = [
  { value: 'true', label: 'yes' },
  { value: 'false', label: 'no' },
];

type ControlAria = { 'aria-invalid'?: boolean; 'aria-describedby'?: string };

/** A form drawn from a step type's config schema, controlled by the document: every change is written straight back. */
export function SchemaForm(props: SchemaFormProps): ReactElement {
  const { failures } = useConfigFormContext();
  const errorId = useId();
  const reason = failures[props.path ?? ''];
  const aria: ControlAria =
    reason === undefined ? {} : { 'aria-invalid': true, 'aria-describedby': errorId };

  return (
    <>
      <SchemaControl {...props} aria={aria} />
      {reason !== undefined && (
        <Typography id={errorId} variant="meta" className="text-tsh-red" role="alert">
          {reason}
        </Typography>
      )}
    </>
  );
}

function SchemaControl({
  schema,
  value,
  onChange,
  readOnly,
  name = null,
  path = '',
  label = 'Value',
  optional = false,
  fallback,
  defaults = {},
  framed = false,
  hidesUnset = false,
  onRenameEntry,
  aria,
}: SchemaFormProps & { aria: ControlAria }): ReactElement {
  const placeholder = describeFallback(fallback);
  const unsetLabel = placeholder ? `— (${placeholder})` : '—';
  const refName = findRefName(schema);
  if (refName !== null && CONDITION_REFS.has(refName)) {
    return <ConditionEditor value={value} onChange={onChange} readOnly={readOnly} />;
  }
  if (refName === JSON_VALUE_REF) {
    return <JsonValueInput value={value} onChange={onChange} readOnly={readOnly} label={label} />;
  }
  if (isCountrySchema(schema)) {
    return <CountryPicker schema={schema} value={value} onChange={onChange} readOnly={readOnly} />;
  }

  const validationType = findValidationType(schema, name);
  if (validationType !== null) {
    return (
      <FieldValidation
        type={validationType}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        framed={framed}
      />
    );
  }

  const resolved = resolveSchema(schema);
  if (listVariants(resolved).length > 0) {
    return (
      <VariantForm
        schema={resolved}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        name={name}
        path={path}
        label={label}
      />
    );
  }

  switch (readKind(resolved)) {
    case 'enum': {
      const options = (resolved.enum ?? [resolved.const]).map((option) => ({
        value: JSON.stringify(option),
        label: String(option),
      }));
      const items =
        optional || value === undefined
          ? [{ value: UNSET, label: unsetLabel }, ...options]
          : options;
      return (
        <Select
          aria-label={label}
          {...aria}
          items={items}
          value={value === undefined ? UNSET : JSON.stringify(value)}
          disabled={readOnly}
          onValueChange={(next) => onChange(next === UNSET ? undefined : JSON.parse(next))}
        />
      );
    }
    case 'boolean':
      return optional ? (
        <Select
          aria-label={label}
          {...aria}
          items={[{ value: UNSET, label: unsetLabel }, ...BOOLEAN_ITEMS]}
          value={typeof value === 'boolean' ? String(value) : UNSET}
          disabled={readOnly}
          onValueChange={(next) => onChange(next === UNSET ? undefined : next === 'true')}
        />
      ) : (
        <Checkbox
          aria-label={label}
          disabled={readOnly}
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
      );
    case 'number':
      return (
        <Input
          type="number"
          size="sm"
          aria-label={label}
          {...aria}
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
        <Input
          font="mono"
          size="sm"
          aria-label={label}
          {...aria}
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
      return (
        <ArrayForm
          schema={resolved}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          path={path}
          label={label}
        />
      );
    case 'object':
      return resolved.properties ? (
        <ObjectForm
          schema={resolved}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          path={path}
          defaults={defaults}
          framed={framed}
          hidesUnset={hidesUnset}
        />
      ) : (
        <MapForm
          schema={resolved}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          name={name}
          path={path}
          onRenameEntry={onRenameEntry}
        />
      );
    default:
      return <JsonValueInput value={value} onChange={onChange} readOnly={readOnly} label={label} />;
  }
}
