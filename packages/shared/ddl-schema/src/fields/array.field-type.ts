import { FIELD_TYPE } from './field-type-names';
import { isInteger } from '../value-guards';
import type { ArrayValidation } from '../workflow-contract';
import type {
  AnyNormalizedField,
  FailWorkflow,
  JsonSchemaFragment,
  WorkflowFieldLevel,
  WorkflowFieldTypeDefinition,
} from './field-type.port';
import { buildFieldDescriptorSchema, buildFieldEnvelope } from './field-value.utils';

export type NormalizedArrayField = AnyNormalizedField & {
  type: 'array';
  items: AnyNormalizedField;
  validation?: ArrayValidation;
};

const isNormalizedArrayField = (field: AnyNormalizedField): field is NormalizedArrayField =>
  field.type === 'array';

export const arrayFieldTypeDefinition = {
  type: FIELD_TYPE.array,
  aliases: [],
  levels: ['root', 'nested', 'arrayItem'],
  buildValidationSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        minItems: { type: 'integer', minimum: 0 },
        maxItems: { type: 'integer', minimum: 0 },
      },
    };
  },
  buildDescriptorSchema(level: WorkflowFieldLevel): JsonSchemaFragment {
    return buildFieldDescriptorSchema(level, {
      typeSchema: { const: 'array' },
      requiredMembers: ['items'],
      members: {
        items: { $ref: '#/definitions/arrayItemDescriptor' },
        validation: { $ref: '#/definitions/arrayValidation' },
      },
      // Quirk preserved: only the nested descriptor declares `when`, the root one does not.
      conditionLevels: ['nested'],
    });
  },
  validateValidation(validation: Record<string, unknown>, fail: FailWorkflow): void {
    for (const key of Object.keys(validation)) {
      if (key !== 'minItems' && key !== 'maxItems') {
        fail('INVALID_VALUE');
      }
    }

    if ('minItems' in validation) {
      const minItems = validation.minItems;
      if (!isInteger(minItems) || minItems < 0) {
        fail('INVALID_VALUE');
      }
    }

    if ('maxItems' in validation) {
      const maxItems = validation.maxItems;
      if (!isInteger(maxItems) || maxItems < 0) {
        fail('INVALID_VALUE');
      }
    }

    if ('minItems' in validation && 'maxItems' in validation) {
      if ((validation.minItems as number) > (validation.maxItems as number)) {
        fail('INVALID_VALUE');
      }
    }
  },
  normalizeField(context, fail: FailWorkflow) {
    if (!Object.prototype.hasOwnProperty.call(context.field, 'items')) {
      fail('INVALID_VALUE');
    }

    const items = context.normalizeChild(context.field.items, 'arrayItem');

    return buildFieldEnvelope(context, 'array', {
      items,
      ...(context.validation === undefined
        ? {}
        : { validation: { ...context.validation } as ArrayValidation }),
    });
  },
  buildDataSchema(field: AnyNormalizedField, buildChildSchema): JsonSchemaFragment {
    if (!isNormalizedArrayField(field)) {
      return { type: 'array', items: {} };
    }

    const schema: JsonSchemaFragment = {
      type: 'array',
      items: buildChildSchema(field.items),
    };

    if (field.validation?.minItems !== undefined) {
      schema.minItems = field.validation.minItems;
    }
    if (field.validation?.maxItems !== undefined) {
      schema.maxItems = field.validation.maxItems;
    }

    return schema;
  },
} as const satisfies WorkflowFieldTypeDefinition;
