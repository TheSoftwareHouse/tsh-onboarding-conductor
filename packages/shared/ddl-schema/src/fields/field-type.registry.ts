import { failWorkflow } from '../workflow-invalid.error';
import { arrayFieldTypeDefinition } from './array.field-type';
import { booleanFieldTypeDefinition } from './boolean.field-type';
import { dateFieldTypeDefinition } from './date.field-type';
import type { WorkflowFieldTypeDefinition } from './field-type.port';
import { fileFieldTypeDefinition } from './file.field-type';
import { numberFieldTypeDefinition } from './number.field-type';
import { objectFieldTypeDefinition } from './object.field-type';
import { textFieldTypeDefinition } from './text.field-type';

/**
 * Single source of truth for the field types a workflow may declare. The order is the order the
 * generated JSON Schema lists descriptors in.
 */
export const FIELD_TYPE_DEFINITIONS = [
  textFieldTypeDefinition,
  numberFieldTypeDefinition,
  booleanFieldTypeDefinition,
  dateFieldTypeDefinition,
  fileFieldTypeDefinition,
  objectFieldTypeDefinition,
  arrayFieldTypeDefinition,
] as const satisfies readonly WorkflowFieldTypeDefinition[];

export type WorkflowFieldTypeName = (typeof FIELD_TYPE_DEFINITIONS)[number]['type'];
export type WorkflowFieldTypeAlias = (typeof FIELD_TYPE_DEFINITIONS)[number]['aliases'][number];

export const WORKFLOW_FIELD_TYPES: readonly WorkflowFieldTypeName[] = FIELD_TYPE_DEFINITIONS.map(
  (definition) => definition.type,
);

export type WorkflowFieldTypeRegistry = ReadonlyMap<string, WorkflowFieldTypeDefinition>;

export const buildFieldTypeRegistry = (
  definitions: readonly WorkflowFieldTypeDefinition[],
): WorkflowFieldTypeRegistry => {
  // A Map, not an object: the key comes from untrusted workflow JSON and must never reach the
  // prototype chain.
  const registry = new Map<string, WorkflowFieldTypeDefinition>();

  for (const definition of definitions) {
    registry.set(definition.type, definition);

    for (const alias of definition.aliases) {
      registry.set(alias, definition);
    }
  }

  return registry;
};

export const FIELD_TYPE_REGISTRY = buildFieldTypeRegistry(FIELD_TYPE_DEFINITIONS);

export const findFieldType = (
  typeName: string,
  registry: WorkflowFieldTypeRegistry = FIELD_TYPE_REGISTRY,
): WorkflowFieldTypeDefinition | undefined => registry.get(typeName);

export const getFieldType = (
  typeName: string,
  registry: WorkflowFieldTypeRegistry = FIELD_TYPE_REGISTRY,
): WorkflowFieldTypeDefinition => {
  return findFieldType(typeName, registry) ?? failWorkflow('INVALID_VALUE');
};

/** The distinct definitions behind a registry, in insertion order and without alias duplicates. */
export const listFieldTypes = (
  registry: WorkflowFieldTypeRegistry = FIELD_TYPE_REGISTRY,
): readonly WorkflowFieldTypeDefinition[] => {
  const definitions: WorkflowFieldTypeDefinition[] = [];

  for (const definition of registry.values()) {
    if (!definitions.includes(definition)) {
      definitions.push(definition);
    }
  }

  return definitions;
};
