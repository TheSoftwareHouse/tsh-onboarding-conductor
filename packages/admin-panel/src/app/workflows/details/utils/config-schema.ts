import { findStepType, STEP_TYPE } from '@tsh/ddl-schema/step-types';
import { getWorkflowJsonSchema } from '@tsh/ddl-schema/workflow-schema';
import { throwReason } from './authored-document';

export type Schema = {
  $ref?: string;
  type?: string;
  enum?: readonly unknown[];
  const?: unknown;
  anyOf?: readonly Schema[];
  oneOf?: readonly Schema[];
  properties?: Record<string, Schema>;
  required?: readonly string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  uniqueItems?: boolean;
  minLength?: number;
  pattern?: string;
};

let definitions: Record<string, Schema> | null = null;

function readDefinitions(): Record<string, Schema> {
  definitions ??= (getWorkflowJsonSchema() as { definitions: Record<string, Schema> }).definitions;
  return definitions;
}

const DEFINITIONS_PREFIX = '#/definitions/';

/** The `$ref` string pointing at a named definition. */
export function toRef(name: string): string {
  return `${DEFINITIONS_PREFIX}${name}`;
}

/** The definition name a `$ref` points at, so a few well-known shapes get a dedicated editor. */
export function findRefName(schema: Schema): string | null {
  return schema.$ref?.replace(DEFINITIONS_PREFIX, '') ?? null;
}

const MAX_REF_DEPTH = 10;

export function resolveSchema(schema: Schema): Schema {
  let current = schema;
  for (let depth = 0; current.$ref !== undefined && depth < MAX_REF_DEPTH; depth += 1) {
    current = readDefinitions()[findRefName(current) ?? ''] ?? {};
  }
  return current;
}

export function listVariants(schema: Schema): Schema[] {
  return [...(schema.anyOf ?? schema.oneOf ?? [])].map(resolveSchema);
}

/** "minAgeYears" → "Min age years". */
export function humanize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export type Kind = 'enum' | 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';

export function readKind(schema: Schema): Kind {
  const resolved = resolveSchema(schema);
  if (resolved.enum !== undefined || resolved.const !== undefined) return 'enum';
  switch (resolved.type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    default:
      return resolved.properties ? 'object' : 'unknown';
  }
}

export function kindOfValue(value: unknown): Kind {
  if (Array.isArray(value)) return 'array';
  if (value === null || value === undefined) return 'unknown';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

/** Every `type` value each variant accepts, when the variants are objects told apart by it (field descriptors). */
function readTagSets(variants: Schema[]): string[][] | null {
  const sets = variants.map((variant) => {
    const tag = variant.properties?.type ? resolveSchema(variant.properties.type) : undefined;
    const values = tag?.const !== undefined ? [tag.const] : (tag?.enum ?? []);
    return values.filter((value): value is string => typeof value === 'string');
  });
  return sets.every((set) => set.length > 0) ? sets : null;
}

/** One tag per variant, its first accepted `type` value; `null` when the variants carry no tag. */
export function readDiscriminator(variants: Schema[]): string[] | null {
  return readTagSets(variants)?.map((set) => set[0]) ?? null;
}

export function pickVariant(variants: Schema[], value: unknown): number {
  const tagSets = readTagSets(variants);
  if (tagSets && typeof value === 'object' && value !== null) {
    const tag = String((value as { type?: unknown }).type);
    const index = tagSets.findIndex((set) => set.includes(tag));
    if (index >= 0) return index;
  }
  const kind = kindOfValue(value);
  const byKind = variants.findIndex((variant) => {
    const variantKind = readKind(variant);
    if (variantKind === 'enum') return (resolveSchema(variant).enum ?? []).includes(value);
    return variantKind === kind;
  });
  return Math.max(byKind, 0);
}

export const JSON_VALUE_REF = 'jsonValue';

export const TRANSITION_CONDITION_REF = 'transitionCondition';

/** The definitions the condition builder edits; their schemas are recursive (`all` holds conditions). */
export const CONDITION_REFS = new Set([TRANSITION_CONDITION_REF, 'condition']);

/** The condition builder's simplest form: a field that is set. */
export const DEFAULT_CONDITION = { field: '', isSet: true } as const;

/** Past this depth a default stops descending, so a self-referencing schema cannot recurse forever. */
const MAX_DEFAULT_DEPTH = 8;

/** A value that satisfies the schema's shape well enough to start editing from. */
export function buildDefault(schema: Schema, depth = 0): unknown {
  // A condition starts as the builder's simplest form; building it from the schema would recurse through `all`.
  if (CONDITION_REFS.has(findRefName(schema) ?? '')) return { ...DEFAULT_CONDITION };
  if (depth > MAX_DEFAULT_DEPTH) return undefined;
  const resolved = resolveSchema(schema);
  const variants = listVariants(resolved);
  if (variants.length > 0) return buildDefault(variants[0], depth + 1);
  if (resolved.const !== undefined) return resolved.const;
  if (resolved.enum !== undefined) return resolved.enum[0];
  switch (readKind(resolved)) {
    case 'string':
      return '';
    case 'number':
      return resolved.minimum ?? 0;
    case 'boolean':
      return false;
    case 'array':
      return resolved.minItems && resolved.items ? [buildDefault(resolved.items, depth + 1)] : [];
    case 'object':
      return Object.fromEntries(
        (resolved.required ?? []).map((key) => [
          key,
          buildDefault(resolved.properties?.[key] ?? {}, depth + 1),
        ]),
      );
    default:
      return '';
  }
}

/** Keys whose value names an existing workflow field; `field` and `codeField` name the field a step creates, so they get no suggestions. */
const FIELD_REFERENCE_KEYS = new Set(['recipientField']);

/** An unset optional value that is easier to start from a default than to show empty: objects, variants, conditions. */
export function isComposite(schema: Schema): boolean {
  if (CONDITION_REFS.has(findRefName(schema) ?? '')) return true;
  const resolved = resolveSchema(schema);
  return listVariants(resolved).length > 0 || resolved.properties !== undefined;
}

/** An optional value left empty is dropped, so clearing an input unsets the setting. */
export function isEmptyValue(value: unknown): boolean {
  if (value === '' || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === 'object' && value !== null && Object.keys(value).length === 0;
}

export function isFieldReference(key: string | null): boolean {
  return key !== null && FIELD_REFERENCE_KEYS.has(key);
}

/** What the engine fills in for each top-level config key left out: whatever `parseConfig` returns that the config does not set. */
export function readConfigDefaults(
  type: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const definition = findStepType(type);
  if (definition === undefined || type === STEP_TYPE.custom) return {};
  try {
    const parsed = definition.parseConfig(config, throwReason) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([key]) => !(key in config)));
  } catch {
    // An invalid config yields no defaults; the form still draws.
    return {};
  }
}
