import { accountNumberFormatDefinition } from './account-number.format';
import type { WorkflowFieldFormatDefinition } from './field-format.port';
import { phoneFormatDefinition } from './phone.format';

/**
 * Single source of truth for the text formats a workflow may declare. The order is the order the
 * generated JSON Schema `format` enum uses.
 */
export const FIELD_FORMAT_DEFINITIONS = [
  { name: 'email', provider: 'ajv-formats' },
  accountNumberFormatDefinition,
  { name: 'uuid', provider: 'ajv-formats' },
  { name: 'uri', provider: 'ajv-formats' },
  phoneFormatDefinition,
] as const satisfies readonly WorkflowFieldFormatDefinition[];

export type WorkflowFieldFormat = (typeof FIELD_FORMAT_DEFINITIONS)[number]['name'];

export const WORKFLOW_FIELD_FORMATS: readonly WorkflowFieldFormat[] = FIELD_FORMAT_DEFINITIONS.map(
  (definition) => definition.name,
);

const fieldFormatsByName = new Map<string, WorkflowFieldFormatDefinition<WorkflowFieldFormat>>(
  FIELD_FORMAT_DEFINITIONS.map((definition) => [definition.name, definition]),
);

export const findFieldFormat = (
  name: string,
): WorkflowFieldFormatDefinition<WorkflowFieldFormat> | undefined => {
  return fieldFormatsByName.get(name);
};
