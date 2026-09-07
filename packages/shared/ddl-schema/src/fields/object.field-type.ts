import { isPlainObject } from '../value-guards';
import type {
  AnyNormalizedField,
  FailWorkflow,
  JsonSchemaFragment,
  WorkflowFieldLevel,
  WorkflowFieldTypeDefinition,
} from './field-type.port';
import { buildFieldDescriptorSchema, buildFieldEnvelope } from './field-value.utils';

type NormalizedNestedField = AnyNormalizedField & { required: boolean };

export type NormalizedObjectField = AnyNormalizedField & {
  type: 'object';
  fields: Record<string, NormalizedNestedField>;
};

const isNormalizedObjectField = (field: AnyNormalizedField): field is NormalizedObjectField =>
  field.type === 'object';

export const objectFieldTypeDefinition = {
  type: 'object',
  aliases: [],
  levels: ['root', 'nested', 'arrayItem'],
  // An object shapes its children through `fields`; it accepts no validation object of its own.
  buildValidationSchema: () => undefined,
  buildDescriptorSchema(level: WorkflowFieldLevel): JsonSchemaFragment {
    return buildFieldDescriptorSchema(level, {
      typeSchema: { const: 'object' },
      requiredMembers: ['fields'],
      members: {
        fields: {
          type: 'object',
          minProperties: 1,
          propertyNames: { $ref: '#/definitions/safeName' },
          additionalProperties: { $ref: '#/definitions/nestedFieldDescriptor' },
        },
      },
      // Quirk preserved: only the nested descriptor declares `when`, the root one does not.
      conditionLevels: ['nested'],
    });
  },
  validateValidation(_validation: Record<string, unknown>, fail: FailWorkflow): void {
    fail('INVALID_VALUE');
  },
  normalizeField(context, fail: FailWorkflow) {
    const fields = context.field.fields;
    if (!isPlainObject(fields)) {
      fail('INVALID_VALUE');
    }

    const fieldEntries = Object.entries(fields as Record<string, unknown>);
    if (fieldEntries.length === 0) {
      fail('INVALID_VALUE');
    }

    const normalizedFields: Record<string, NormalizedNestedField> = {};
    for (const [fieldName, nestedField] of fieldEntries) {
      if (fieldName.trim().length === 0) {
        fail('INVALID_VALUE');
      }

      const normalizedNestedField = context.normalizeChild(nestedField, 'nested');
      if (typeof normalizedNestedField.required !== 'boolean') {
        fail('INVALID_VALUE');
      }

      normalizedFields[fieldName] = normalizedNestedField as NormalizedNestedField;
    }

    return buildFieldEnvelope(context, 'object', { fields: normalizedFields });
  },
  buildDataSchema(field: AnyNormalizedField, buildChildSchema): JsonSchemaFragment {
    const fields = isNormalizedObjectField(field) ? field.fields : {};

    return {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        Object.entries(fields).map(([fieldName, nestedField]) => [
          fieldName,
          buildChildSchema(nestedField),
        ]),
      ),
      required: Object.entries(fields)
        .filter(([, nestedField]) => nestedField.required)
        .map(([fieldName]) => fieldName),
    };
  },
} as const satisfies WorkflowFieldTypeDefinition;
