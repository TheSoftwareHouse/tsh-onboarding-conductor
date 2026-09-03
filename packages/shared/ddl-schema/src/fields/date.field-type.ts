import { isInteger } from '../value-guards';
import type { DateValidation } from '../workflow-contract';
import type {
  AnyNormalizedField,
  FailWorkflow,
  FieldDataKeyword,
  JsonSchemaFragment,
  WorkflowFieldLevel,
  WorkflowFieldTypeDefinition,
} from './field-type.port';
import {
  buildFieldDescriptorSchema,
  buildFieldEnvelope,
  buildSelectionListSchema,
  isFullDateString,
  validateSelectionValues,
} from './field-value.utils';

export type NormalizedDateField = AnyNormalizedField & {
  type: 'date';
  validation?: DateValidation;
};

const isNormalizedDateField = (field: AnyNormalizedField): field is NormalizedDateField =>
  field.type === 'date';

const isDateValue = (value: unknown): value is string =>
  typeof value === 'string' && isFullDateString(value);

const AGE_KEYS = ['minAgeYears', 'maxAgeYears'] as const;

const ALLOWED_VALIDATION_KEYS = ['oneOf', 'manyOf', ...AGE_KEYS];

/**
 * Whole years between a date and `now`, both read in UTC so the answer does not depend on where
 * the engine runs. Negative for a date in the future, which is what makes a future date of birth
 * fail a `minAgeYears` bound rather than satisfy it.
 */
const fullYearsSince = (value: string, now: Date): number | undefined => {
  if (!isDateValue(value)) {
    return undefined;
  }

  const [year, month, day] = value.split('-').map(Number);
  const hasNotHadBirthdayThisYear =
    now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day);

  return now.getUTCFullYear() - year - (hasNotHadBirthdayThisYear ? 1 : 0);
};

/**
 * Resolved per submission, never at compile time: `Step` caches compiled validators for the life
 * of the process, so a bound inlined at compile time would freeze the day the workflow loaded.
 */
const ageKeywords: readonly FieldDataKeyword[] = [
  {
    keyword: 'minAgeYears',
    type: 'string',
    schemaType: 'number',
    validate: ((minimumAge: number, value: string): boolean => {
      const age = fullYearsSince(value, new Date());
      return age !== undefined && age >= minimumAge;
    }) as FieldDataKeyword['validate'],
  },
  {
    keyword: 'maxAgeYears',
    type: 'string',
    schemaType: 'number',
    validate: ((maximumAge: number, value: string): boolean => {
      const age = fullYearsSince(value, new Date());
      return age !== undefined && age <= maximumAge;
    }) as FieldDataKeyword['validate'],
  },
];

const buildSelectionSchema = (): JsonSchemaFragment => ({
  type: 'array',
  minItems: 1,
  uniqueItems: true,
  items: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
});

/** The age bounds ride on the item schema for `manyOf`, so every selected date is held to them. */
const applyAgeBounds = (
  schema: JsonSchemaFragment,
  validation: DateValidation | undefined,
): JsonSchemaFragment => {
  if (validation?.minAgeYears !== undefined) {
    schema.minAgeYears = validation.minAgeYears;
  }
  if (validation?.maxAgeYears !== undefined) {
    schema.maxAgeYears = validation.maxAgeYears;
  }

  return schema;
};

export const dateFieldTypeDefinition = {
  type: 'date',
  aliases: [],
  levels: ['root', 'nested', 'arrayItem'],
  dataKeywords: ageKeywords,
  buildValidationSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        oneOf: buildSelectionSchema(),
        manyOf: buildSelectionSchema(),
        minAgeYears: { type: 'integer', minimum: 0 },
        maxAgeYears: { type: 'integer', minimum: 0 },
      },
      not: {
        type: 'object',
        properties: { oneOf: {}, manyOf: {} },
        required: ['oneOf', 'manyOf'],
      },
    };
  },
  buildDescriptorSchema(level: WorkflowFieldLevel): JsonSchemaFragment {
    return buildFieldDescriptorSchema(level, {
      typeSchema: { const: 'date' },
      members: { validation: { $ref: '#/definitions/dateValidation' } },
      conditionLevels: ['root'],
    });
  },
  validateValidation(validation: Record<string, unknown>, fail: FailWorkflow): void {
    for (const key of Object.keys(validation)) {
      if (!ALLOWED_VALIDATION_KEYS.includes(key)) {
        fail('INVALID_VALUE');
      }
    }

    if ('oneOf' in validation && 'manyOf' in validation) {
      fail('INVALID_VALUE');
    }

    if ('oneOf' in validation) {
      validateSelectionValues(validation.oneOf, isDateValue, fail);
    }

    if ('manyOf' in validation) {
      validateSelectionValues(validation.manyOf, isDateValue, fail);
    }

    for (const key of AGE_KEYS) {
      if (key in validation) {
        const bound = validation[key];
        if (!isInteger(bound) || bound < 0) {
          fail('INVALID_VALUE');
        }
      }
    }

    if ('minAgeYears' in validation && 'maxAgeYears' in validation) {
      if ((validation.minAgeYears as number) > (validation.maxAgeYears as number)) {
        fail('INVALID_VALUE');
      }
    }

    // A `oneOf` literal is deliberately not checked against the age bounds: the bound moves with
    // the calendar, so a workflow that loaded today would stop loading tomorrow.
  },
  normalizeField(context) {
    return buildFieldEnvelope(
      context,
      'date',
      context.validation === undefined
        ? {}
        : { validation: { ...context.validation } as DateValidation },
    );
  },
  buildDataSchema(field: AnyNormalizedField): JsonSchemaFragment {
    const validation = isNormalizedDateField(field) ? field.validation : undefined;

    if (validation?.manyOf) {
      return buildSelectionListSchema(
        applyAgeBounds({ type: 'string', format: 'date' }, validation),
        validation.manyOf,
      );
    }

    const schema: JsonSchemaFragment = applyAgeBounds(
      { type: 'string', format: 'date' },
      validation,
    );

    if (validation?.oneOf) {
      schema.enum = [...validation.oneOf];
    }

    return schema;
  },
  validateConditionLiteral(value, field: AnyNormalizedField, fail: FailWorkflow): void {
    if (!isNormalizedDateField(field)) {
      return fail('INVALID_VALUE');
    }

    if (field.validation?.manyOf !== undefined) {
      fail('INVALID_VALUE');
    }

    if (!isDateValue(value)) {
      return fail('INVALID_VALUE');
    }

    const allowedValues = field.validation?.oneOf;
    if (allowedValues !== undefined && !allowedValues.includes(value)) {
      fail('INVALID_VALUE');
    }
  },
} as const satisfies WorkflowFieldTypeDefinition;
