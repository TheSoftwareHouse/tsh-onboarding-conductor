import { FIELD_TYPE } from './field-type-names';
import type { NumberValidation } from '../workflow-contract';
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
  validateSelectionIsSubmittable,
  validateSelectionValues,
} from './field-value.utils';

export type NormalizedNumberField = AnyNormalizedField & {
  type: 'number';
  validation?: NumberValidation;
};

const isNormalizedNumberField = (field: AnyNormalizedField): field is NormalizedNumberField =>
  field.type === 'number';

const ALLOWED_VALIDATION_KEYS = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'oneOf',
  'manyOf',
];

const BOUND_KEYS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'] as const;

const isNumberValue = (value: unknown): value is number =>
  typeof value === 'number' && !Number.isNaN(value);

const satisfiesBounds = (value: number, validation: Record<string, unknown>): boolean => {
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum } =
    validation as Partial<NumberValidation>;

  if (minimum !== undefined && value < minimum) {
    return false;
  }
  if (maximum !== undefined && value > maximum) {
    return false;
  }
  if (exclusiveMinimum !== undefined && value <= exclusiveMinimum) {
    return false;
  }
  if (exclusiveMaximum !== undefined && value >= exclusiveMaximum) {
    return false;
  }

  return true;
};

export const numberFieldTypeDefinition = {
  type: FIELD_TYPE.number,
  aliases: [],
  levels: ['root', 'nested', 'arrayItem'],
  buildValidationSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        minimum: { type: 'number' },
        maximum: { type: 'number' },
        exclusiveMinimum: { type: 'number' },
        exclusiveMaximum: { type: 'number' },
        oneOf: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'number' } },
        manyOf: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'number' } },
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
      typeSchema: { const: 'number' },
      members: { validation: { $ref: '#/definitions/numberValidation' } },
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

    for (const key of BOUND_KEYS) {
      if (key in validation && !isNumberValue(validation[key])) {
        fail('INVALID_VALUE');
      }
    }

    if ('minimum' in validation && 'maximum' in validation) {
      if ((validation.minimum as number) > (validation.maximum as number)) {
        fail('INVALID_VALUE');
      }
    }
    if ('exclusiveMinimum' in validation && 'maximum' in validation) {
      if ((validation.exclusiveMinimum as number) >= (validation.maximum as number)) {
        fail('INVALID_VALUE');
      }
    }
    if ('minimum' in validation && 'exclusiveMaximum' in validation) {
      if ((validation.minimum as number) >= (validation.exclusiveMaximum as number)) {
        fail('INVALID_VALUE');
      }
    }
    if ('exclusiveMinimum' in validation && 'exclusiveMaximum' in validation) {
      if ((validation.exclusiveMinimum as number) >= (validation.exclusiveMaximum as number)) {
        fail('INVALID_VALUE');
      }
    }

    if ('oneOf' in validation) {
      validateSelectionValues(validation.oneOf, isNumberValue, fail);
    }

    if ('manyOf' in validation) {
      validateSelectionValues(validation.manyOf, isNumberValue, fail);
    }

    validateSelectionIsSubmittable(
      validation,
      (value) => isNumberValue(value) && satisfiesBounds(value, validation),
      fail,
    );
  },
  normalizeField(context) {
    return buildFieldEnvelope(
      context,
      'number',
      context.validation === undefined
        ? {}
        : { validation: { ...context.validation } as NumberValidation },
    );
  },
  buildDataSchema(field: AnyNormalizedField): JsonSchemaFragment {
    const validation = isNormalizedNumberField(field) ? field.validation : undefined;

    if (validation?.manyOf) {
      return buildSelectionListSchema({ type: 'number' }, validation.manyOf);
    }

    const schema: JsonSchemaFragment = { type: 'number' };

    if (validation?.minimum !== undefined) {
      schema.minimum = validation.minimum;
    }
    if (validation?.maximum !== undefined) {
      schema.maximum = validation.maximum;
    }
    if (validation?.exclusiveMinimum !== undefined) {
      schema.exclusiveMinimum = validation.exclusiveMinimum;
    }
    if (validation?.exclusiveMaximum !== undefined) {
      schema.exclusiveMaximum = validation.exclusiveMaximum;
    }
    if (validation?.oneOf) {
      schema.enum = [...validation.oneOf];
    }

    return schema;
  },
  validateConditionLiteral(value, field: AnyNormalizedField, fail: FailWorkflow): void {
    if (!isNormalizedNumberField(field)) {
      return fail('INVALID_VALUE');
    }

    if (field.validation?.manyOf !== undefined) {
      fail('INVALID_VALUE');
    }

    if (!isNumberValue(value)) {
      return fail('INVALID_VALUE');
    }

    const allowedValues = field.validation?.oneOf;
    if (allowedValues !== undefined && !allowedValues.includes(value)) {
      fail('INVALID_VALUE');
    }
  },
} as const satisfies WorkflowFieldTypeDefinition;
