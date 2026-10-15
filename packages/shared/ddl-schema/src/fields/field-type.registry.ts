import { failWorkflow } from '../workflow-invalid.error';
import { arrayFieldTypeDefinition } from './array.field-type';
import { booleanFieldTypeDefinition } from './boolean.field-type';
import { dateFieldTypeDefinition } from './date.field-type';
import type { WorkflowFieldTypeDefinition } from './field-type.port';
import { fileFieldTypeDefinition } from './file.field-type';
import { jsonFieldTypeDefinition } from './json.field-type';
import { numberFieldTypeDefinition } from './number.field-type';
import { objectFieldTypeDefinition } from './object.field-type';
import { textFieldTypeDefinition } from './text.field-type';

/**
 * The field types compiled into the package. Externally mounted types are added at startup through
 * `registerFieldType`, so read the current set with `listFieldTypes`, never from this array.
 */
export const BUILT_IN_FIELD_TYPES = [
  textFieldTypeDefinition,
  numberFieldTypeDefinition,
  booleanFieldTypeDefinition,
  dateFieldTypeDefinition,
  fileFieldTypeDefinition,
  jsonFieldTypeDefinition,
  objectFieldTypeDefinition,
  arrayFieldTypeDefinition,
] as const satisfies readonly WorkflowFieldTypeDefinition[];

export type BuiltInWorkflowFieldType = (typeof BUILT_IN_FIELD_TYPES)[number]['type'];
export type WorkflowFieldTypeAlias = (typeof BUILT_IN_FIELD_TYPES)[number]['aliases'][number];

/** Widened on purpose: a mounted type contributes a name the compiler cannot know. */
export type WorkflowFieldTypeName = BuiltInWorkflowFieldType | (string & Record<never, never>);

export type WorkflowFieldTypeRegistry = ReadonlyMap<string, WorkflowFieldTypeDefinition>;

/**
 * Builds an isolated registry. Each definition is keyed by its canonical name and by every alias.
 * A Map, not an object: names come from untrusted workflow JSON and must not reach the prototype.
 */
export const buildFieldTypeRegistry = (
  definitions: readonly WorkflowFieldTypeDefinition[],
): Map<string, WorkflowFieldTypeDefinition> => {
  const registry = new Map<string, WorkflowFieldTypeDefinition>();

  for (const definition of definitions) {
    registry.set(definition.type, definition);

    for (const alias of definition.aliases) {
      registry.set(alias, definition);
    }
  }

  return registry;
};

const defaultRegistry = buildFieldTypeRegistry(BUILT_IN_FIELD_TYPES);

let fieldTypeRegistryVersion = 0;

/** Changes whenever the registry is mutated, so derived artifacts know to rebuild. */
export const getFieldTypeRegistryVersion = (): number => fieldTypeRegistryVersion;

/**
 * Mounts a field type. Call during startup, before the first workflow is validated; anything
 * already derived from the registry rebuilds on next use.
 */
export const registerFieldType = (definition: WorkflowFieldTypeDefinition): void => {
  defaultRegistry.set(definition.type, definition);

  for (const alias of definition.aliases) {
    defaultRegistry.set(alias, definition);
  }

  fieldTypeRegistryVersion += 1;
};

export const getFieldTypeRegistry = (): WorkflowFieldTypeRegistry => defaultRegistry;

export const findFieldType = (
  typeName: string,
  registry: WorkflowFieldTypeRegistry = defaultRegistry,
): WorkflowFieldTypeDefinition | undefined => registry.get(typeName);

export const getFieldType = (
  typeName: string,
  registry: WorkflowFieldTypeRegistry = defaultRegistry,
): WorkflowFieldTypeDefinition => {
  return findFieldType(typeName, registry) ?? failWorkflow('INVALID_VALUE');
};

/** The distinct definitions in a registry, in insertion order and without alias duplicates. */
export const listFieldTypes = (
  registry: WorkflowFieldTypeRegistry = defaultRegistry,
): readonly WorkflowFieldTypeDefinition[] => {
  const definitions: WorkflowFieldTypeDefinition[] = [];

  for (const definition of registry.values()) {
    if (!definitions.includes(definition)) {
      definitions.push(definition);
    }
  }

  return definitions;
};
