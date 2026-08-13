import type { DateValidation } from '../workflow-contract';
import type {
  AnyNormalizedField,
  FailWorkflow,
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

const buildSelectionSchema = (): JsonSchemaFragment => ({
  type: 'array',
  minItems: 1,
  uniqueItems: true,
  items: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
});

export const dateFieldTypeDefinition = {
  type: 'date',
  aliases: [],
  levels: ['root', 'nested', 'arrayItem'],
  buildValidationSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        oneOf: buildSelectionSchema(),
        manyOf: buildSelectionSchema(),
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
      if (key !== 'oneOf' && key !== 'manyOf') {
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
      return buildSelectionListSchema({ type: 'string', format: 'date' }, validation.manyOf);
    }

    const schema: JsonSchemaFragment = { type: 'string', format: 'date' };

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
