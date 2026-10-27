import { findStepType } from '@tsh/ddl-schema/step-types';
import { withHttpRequestSchema } from './http-request-schema';
import { pluralize } from './pluralize';
import { isPlainObject } from './is-plain-object';
import {
  CONDITION_REFS,
  JSON_VALUE_REF,
  findRefName,
  listVariants,
  pickVariant,
  resolveSchema,
  type Schema,
} from './config-schema';

/** Failing settings by path (`request.timeoutMs`, `docs[1].type`), each with a short reason. */
export type ConfigFailures = Record<string, string>;

const TYPE_REASONS: Record<string, string> = {
  string: 'Must be text',
  number: 'Must be a number',
  integer: 'Must be a whole number',
  boolean: 'Must be yes or no',
  array: 'Must be a list',
  object: 'Must be an object',
};

/** The path of an object member or map entry under `path`. */
export function toMemberPath(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

/** The path of a list entry under `path`. */
export function toEntryPath(path: string, index: number): string {
  return `${path}[${index}]`;
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
    default:
      return true;
  }
}

function describeBounds(minimum?: number, maximum?: number): string {
  if (minimum !== undefined && maximum !== undefined) return `Must be ${minimum}–${maximum}`;
  return minimum !== undefined ? `Must be at least ${minimum}` : `Must be at most ${maximum}`;
}

function matchesPattern(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    // A pattern this engine cannot read is not the author's mistake.
    return true;
  }
}

function findReason(schema: Schema, value: unknown): string | undefined {
  if (schema.const !== undefined && value !== schema.const) return 'Not one of the allowed values';
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    return 'Not one of the allowed values';
  }
  if (schema.type !== undefined && !matchesType(schema.type, value)) {
    return TYPE_REASONS[schema.type];
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return schema.minLength === 1
        ? 'Must not be empty'
        : `At least ${schema.minLength} characters`;
    }
    if (schema.pattern !== undefined && !matchesPattern(schema.pattern, value)) {
      return 'Does not match the required format';
    }
  }
  if (typeof value === 'number') {
    const { minimum, maximum } = schema;
    if ((minimum !== undefined && value < minimum) || (maximum !== undefined && value > maximum)) {
      return describeBounds(minimum, maximum);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return `Add at least ${pluralize(schema.minItems, 'entry', 'entries')}`;
    }
    if (
      schema.uniqueItems &&
      new Set(value.map((entry) => JSON.stringify(entry))).size < value.length
    ) {
      return 'Entries must be unique';
    }
  }
  return undefined;
}

function collectFailures(
  schema: Schema,
  value: unknown,
  path: string,
  failures: ConfigFailures,
): void {
  if (value === undefined) return;
  const refName = findRefName(schema);
  // Conditions and free-form JSON have editors of their own, and a condition's schema is recursive.
  if (refName === JSON_VALUE_REF || CONDITION_REFS.has(refName ?? '')) return;
  const resolved = resolveSchema(schema);
  const variants = listVariants(resolved);
  if (variants.length > 0) {
    return collectFailures(variants[pickVariant(variants, value)], value, path, failures);
  }
  const reason = findReason(resolved, value);
  if (reason !== undefined) {
    failures[path] ??= reason;
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectFailures(resolved.items ?? {}, entry, toEntryPath(path, index), failures),
    );
  }
  if (!isPlainObject(value)) return;
  for (const key of resolved.required ?? []) {
    if (value[key] === undefined) failures[toMemberPath(path, key)] ??= 'Required';
  }
  const extra =
    typeof resolved.additionalProperties === 'object' ? resolved.additionalProperties : null;
  for (const [key, member] of Object.entries(value)) {
    const memberSchema = resolved.properties?.[key] ?? extra;
    if (memberSchema) collectFailures(memberSchema, member, toMemberPath(path, key), failures);
  }
}

/** Checks a value against the JSON Schema its form is drawn from; no `ajv`, only the keywords the config schemas use. */
export function checkConfig(schema: Schema, value: unknown): ConfigFailures {
  const failures: ConfigFailures = {};
  collectFailures(schema, value, '', failures);
  return failures;
}

/** Checks a step's config against its type's schema, as the form draws it. */
export function checkStepConfig(type: string, config: Record<string, unknown>): ConfigFailures {
  const schema = findStepType(type)?.buildConfigSchema() as Schema | undefined;
  return schema ? checkConfig(withHttpRequestSchema(type, schema, config), config) : {};
}
