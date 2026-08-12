import { findFieldFormat, listFieldFormatNames } from '../formats/field-format.registry';
import { isInteger } from '../value-guards';
import type { TextValidation } from '../workflow-contract';
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
  validateSelectionValues,
} from './field-value.utils';

export type NormalizedTextField = AnyNormalizedField & {
  type: 'text';
  validation?: TextValidation;
};

const isNormalizedTextField = (field: AnyNormalizedField): field is NormalizedTextField =>
  field.type === 'text';

const ALLOWED_VALIDATION_KEYS = ['minLength', 'maxLength', 'pattern', 'format', 'oneOf', 'manyOf'];

export const textFieldTypeDefinition = {
  type: 'text',
  aliases: ['string'],
  levels: ['root', 'nested', 'arrayItem'],
  buildValidationSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        minLength: { type: 'integer', minimum: 0 },
        maxLength: { type: 'integer', minimum: 0 },
        pattern: { type: 'string' },
        // Read live: a format mounted at startup must appear in the enum.
        format: { enum: listFieldFormatNames() },
        oneOf: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } },
        manyOf: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } },
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
      typeSchema: { enum: ['text', 'string'] },
      members: { validation: { $ref: '#/definitions/textValidation' } },
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

    if ('minLength' in validation) {
      const minLength = validation.minLength;
      if (!isInteger(minLength) || minLength < 0) {
        fail('INVALID_VALUE');
      }
    }

    if ('maxLength' in validation) {
      const maxLength = validation.maxLength;
      if (!isInteger(maxLength) || maxLength < 0) {
        fail('INVALID_VALUE');
      }
    }

    if ('minLength' in validation && 'maxLength' in validation) {
      if ((validation.minLength as number) > (validation.maxLength as number)) {
        fail('INVALID_VALUE');
      }
    }

    if ('pattern' in validation) {
      const pattern = validation.pattern;
      if (typeof pattern !== 'string') {
        fail('INVALID_VALUE');
      }
      try {
        new RegExp(pattern as string);
      } catch {
        fail('INVALID_VALUE');
      }
    }

    if ('format' in validation) {
      const format = validation.format;
      if (typeof format !== 'string' || findFieldFormat(format) === undefined) {
        fail('INVALID_VALUE');
      }
    }

    if ('oneOf' in validation) {
      validateSelectionValues(validation.oneOf, (value) => typeof value === 'string', fail);
    }

    if ('manyOf' in validation) {
      validateSelectionValues(validation.manyOf, (value) => typeof value === 'string', fail);
    }
  },
  normalizeField(context) {
    return buildFieldEnvelope(
      context,
      'text',
      context.validation === undefined
        ? {}
        : { validation: { ...context.validation } as TextValidation },
    );
  },
  buildDataSchema(field: AnyNormalizedField): JsonSchemaFragment {
    const validation = isNormalizedTextField(field) ? field.validation : undefined;

    if (validation?.manyOf) {
      return buildSelectionListSchema({ type: 'string' }, validation.manyOf);
    }

    const schema: JsonSchemaFragment = { type: 'string' };

    if (validation?.minLength !== undefined) {
      schema.minLength = validation.minLength;
    }
    if (validation?.maxLength !== undefined) {
      schema.maxLength = validation.maxLength;
    }
    if (validation?.pattern !== undefined) {
      schema.pattern = validation.pattern;
    }
    if (validation?.format !== undefined) {
      schema.format = validation.format;
    }
    if (validation?.oneOf) {
      schema.enum = [...validation.oneOf];
    }

    return schema;
  },
  validateConditionLiteral(value, field: AnyNormalizedField, fail: FailWorkflow): void {
    if (!isNormalizedTextField(field)) {
      return fail('INVALID_VALUE');
    }

    if (field.validation?.manyOf !== undefined) {
      fail('INVALID_VALUE');
    }

    if (typeof value !== 'string') {
      return fail('INVALID_VALUE');
    }

    const allowedValues = field.validation?.oneOf;
    if (allowedValues !== undefined && !allowedValues.includes(value)) {
      fail('INVALID_VALUE');
    }
  },
} as const satisfies WorkflowFieldTypeDefinition;
