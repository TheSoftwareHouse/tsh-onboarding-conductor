import { FIELD_TYPE } from './field-type-names';
import type { BooleanValidation } from '../workflow-contract';
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
  validateSelectionValues,
} from './field-value.utils';

export type NormalizedBooleanField = AnyNormalizedField & {
  type: 'boolean';
  validation?: BooleanValidation;
};

const isNormalizedBooleanField = (field: AnyNormalizedField): field is NormalizedBooleanField =>
  field.type === 'boolean';

const isBooleanValue = (value: unknown): value is boolean => typeof value === 'boolean';

export const booleanFieldTypeDefinition = {
  type: FIELD_TYPE.boolean,
  aliases: [],
  levels: ['root', 'nested', 'arrayItem'],
  // Deliberately no `manyOf`: a boolean multi-selection carries no meaning.
  buildValidationSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        oneOf: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'boolean' } },
      },
    };
  },
  buildDescriptorSchema(level: WorkflowFieldLevel): JsonSchemaFragment {
    return buildFieldDescriptorSchema(level, {
      typeSchema: { const: 'boolean' },
      members: { validation: { $ref: '#/definitions/booleanValidation' } },
      conditionLevels: ['root'],
    });
  },
  validateValidation(validation: Record<string, unknown>, fail: FailWorkflow): void {
    for (const key of Object.keys(validation)) {
      if (key !== 'oneOf') {
        fail('INVALID_VALUE');
      }
    }

    if ('oneOf' in validation) {
      validateSelectionValues(validation.oneOf, isBooleanValue, fail);
    }
  },
  normalizeField(context) {
    return buildFieldEnvelope(
      context,
      'boolean',
      context.validation === undefined
        ? {}
        : { validation: { ...context.validation } as BooleanValidation },
    );
  },
  buildDataSchema(field: AnyNormalizedField): JsonSchemaFragment {
    const validation = isNormalizedBooleanField(field) ? field.validation : undefined;
    const schema: JsonSchemaFragment = { type: 'boolean' };

    if (validation?.oneOf) {
      schema.enum = [...validation.oneOf];
    }

    return schema;
  },
  validateConditionLiteral(value, field: AnyNormalizedField, fail: FailWorkflow): void {
    if (!isNormalizedBooleanField(field)) {
      return fail('INVALID_VALUE');
    }

    if (!isBooleanValue(value)) {
      return fail('INVALID_VALUE');
    }

    const allowedValues = field.validation?.oneOf;
    if (allowedValues !== undefined && !allowedValues.includes(value)) {
      fail('INVALID_VALUE');
    }
  },
} as const satisfies WorkflowFieldTypeDefinition;
