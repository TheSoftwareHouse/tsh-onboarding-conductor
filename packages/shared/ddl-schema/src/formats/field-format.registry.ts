import { accountNumberFormatDefinition } from './account-number.format';
import type { WorkflowFieldFormatDefinition } from './field-format.port';
import { phoneFormatDefinition } from './phone.format';

/**
 * The formats compiled into the package. Externally mounted formats are added at startup through
 * `registerFieldFormat`, so read the current set with `listFieldFormats`, never from this array.
 */
export const BUILT_IN_FIELD_FORMATS = [
  { name: 'email', provider: 'ajv-formats' },
  accountNumberFormatDefinition,
  { name: 'uuid', provider: 'ajv-formats' },
  { name: 'uri', provider: 'ajv-formats' },
  phoneFormatDefinition,
] as const satisfies readonly WorkflowFieldFormatDefinition[];

export type BuiltInWorkflowFieldFormat = (typeof BUILT_IN_FIELD_FORMATS)[number]['name'];

/** Widened on purpose: a mounted format contributes a name the compiler cannot know. */
export type WorkflowFieldFormat = BuiltInWorkflowFieldFormat | (string & Record<never, never>);

// A Map, not an object: names come from untrusted workflow JSON and must not reach the prototype.
const fieldFormatsByName = new Map<string, WorkflowFieldFormatDefinition>(
  BUILT_IN_FIELD_FORMATS.map((definition) => [definition.name, definition]),
);

let formatRegistryVersion = 0;

/** Changes whenever the registry is mutated, so derived artifacts know to rebuild. */
export const getFieldFormatRegistryVersion = (): number => formatRegistryVersion;

/**
 * Mounts a format. Call during startup, before the first workflow is validated; anything already
 * derived from the registry rebuilds on next use.
 */
export const registerFieldFormat = (definition: WorkflowFieldFormatDefinition): void => {
  fieldFormatsByName.set(definition.name, definition);
  formatRegistryVersion += 1;
};

export const findFieldFormat = (name: string): WorkflowFieldFormatDefinition | undefined => {
  return fieldFormatsByName.get(name);
};

/** Every registered format, built-ins first, in registration order. */
export const listFieldFormats = (): readonly WorkflowFieldFormatDefinition[] => [
  ...fieldFormatsByName.values(),
];

export const listFieldFormatNames = (): readonly string[] => [...fieldFormatsByName.keys()];
