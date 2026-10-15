import type {
  AnyNormalizedField,
  FailWorkflow,
  JsonSchemaFragment,
  WorkflowFieldLevel,
  WorkflowFieldTypeDefinition,
} from './field-type.port';
import { buildFieldDescriptorSchema, buildFieldEnvelope } from './field-value.utils';

export type NormalizedJsonField = AnyNormalizedField & { type: 'json' };

/**
 * An open JSON object: any properties, any nesting. It exists for values the engine only carries —
 * a provider's report — where `object` cannot be used because it must enumerate its children and
 * refuses every other key. Root level only, so a document never nests an unchecked shape inside a
 * checked one, and it cannot be compared in a condition.
 */
export const jsonFieldTypeDefinition = {
  type: 'json',
  aliases: [],
  levels: ['root'],
  buildValidationSchema: () => undefined,
  buildDescriptorSchema(level: WorkflowFieldLevel): JsonSchemaFragment {
    return buildFieldDescriptorSchema(level, {
      typeSchema: { const: 'json' },
      members: {},
      conditionLevels: [],
    });
  },
  validateValidation(_validation: Record<string, unknown>, fail: FailWorkflow): void {
    fail('INVALID_VALUE');
  },
  normalizeField(context) {
    return buildFieldEnvelope(context, 'json', {});
  },
  buildDataSchema(): JsonSchemaFragment {
    return { type: 'object' };
  },
} as const satisfies WorkflowFieldTypeDefinition;
