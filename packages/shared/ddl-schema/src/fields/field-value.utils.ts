import type {
  AnyNormalizedField,
  FailWorkflow,
  FieldNormalizationContext,
  JsonSchemaFragment,
  WorkflowFieldLevel,
} from './field-type.port';

export const isFullDateString = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

/**
 * Builds the level-dependent part of a normalized field — `required` and `persist` — around the
 * members the field type itself owns. Conditions are attached by the orchestrator once every root
 * field is known, so `when` is deliberately not carried over here.
 */
export const buildFieldEnvelope = <TType extends string, TMembers extends Record<string, unknown>>(
  context: FieldNormalizationContext,
  type: TType,
  members: TMembers,
): AnyNormalizedField & TMembers & { type: TType } => {
  const normalized: Record<string, unknown> = { type };

  if (context.includeRequired) {
    normalized.required = context.required;
  }

  if (context.includePersist) {
    normalized.persist = context.persist ?? true;
  }

  Object.assign(normalized, members);

  return normalized as AnyNormalizedField & TMembers & { type: TType };
};

export const validateSelectionValues = (
  values: unknown,
  isAllowedValue: (value: unknown) => boolean,
  fail: FailWorkflow,
): void => {
  if (!Array.isArray(values) || values.length === 0) {
    fail('INVALID_VALUE');
  }

  const valuesArray = values as unknown[];

  if (new Set(valuesArray).size !== valuesArray.length) {
    fail('INVALID_VALUE');
  }

  for (const value of valuesArray) {
    if (!isAllowedValue(value)) {
      fail('INVALID_VALUE');
    }
  }
};

export type FieldDescriptorSpec = {
  /** `{ const: 'number' }` for most types, `{ enum: ['text', 'string'] }` for aliased ones. */
  readonly typeSchema: JsonSchemaFragment;
  /** Overrides the `required` flag schema, for types that pin it to a single value. */
  readonly requiredSchema?: JsonSchemaFragment;
  /** Type-owned properties such as `validation`, `fields` or `items`, in declaration order. */
  readonly members: Record<string, unknown>;
  readonly requiredMembers?: readonly string[];
  /** Levels at which the type declares a `when` condition. */
  readonly conditionLevels: readonly WorkflowFieldLevel[];
};

/**
 * Composes a descriptor definition for one level. `required` exists everywhere except inside an
 * array's `items`, `persist` only at step-data level, and `when` only where the type declares it.
 */
export const buildFieldDescriptorSchema = (
  level: WorkflowFieldLevel,
  spec: FieldDescriptorSpec,
): JsonSchemaFragment => {
  const properties: Record<string, unknown> = { type: spec.typeSchema };

  if (level !== 'arrayItem') {
    properties.required = spec.requiredSchema ?? { type: 'boolean' };
  }

  if (level === 'root') {
    properties.persist = { type: 'boolean' };
  }

  if (spec.conditionLevels.includes(level)) {
    properties.when = { $ref: '#/definitions/condition' };
  }

  Object.assign(properties, spec.members);

  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'type',
      ...(level === 'arrayItem' ? [] : ['required']),
      ...(spec.requiredMembers ?? []),
    ],
    properties,
  };
};

/**
 * Selection-list schema for the `manyOf` step-data shape shared by `text`, `number` and `date`.
 */
export const buildSelectionListSchema = (
  itemSchema: Record<string, unknown>,
  values: readonly unknown[],
): Record<string, unknown> => ({
  type: 'array',
  minItems: 1,
  uniqueItems: true,
  items: { ...itemSchema, enum: [...values] },
});
