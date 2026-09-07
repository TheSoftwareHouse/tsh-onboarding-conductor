import { isInteger, isPlainObject } from '../value-guards';
import type { RawWorkflowCondition } from '../workflow-condition';
import { CONNECTOR_TYPES, type ConnectorType, type RawWorkflowField } from '../workflow-contract';
import type { FailWorkflow, JsonSchemaFragment } from './node-type.port';

/** The port every node with exactly one outcome exposes. */
export const SUCCESS_PORT = 'success';

/** The port a node routes to when no other arm claimed the submit. */
export const DEFAULT_PORT = 'default';

export const asConfigObject = (
  config: Record<string, unknown> | undefined,
  fail: FailWorkflow,
): Record<string, unknown> => {
  if (config === undefined) {
    return {};
  }

  if (!isPlainObject(config)) {
    fail('INVALID_VALUE');
  }

  return config;
};

export const readString = (value: unknown, fail: FailWorkflow): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('INVALID_VALUE');
  }

  return value as string;
};

export const readOptionalString = (value: unknown, fail: FailWorkflow): string | undefined =>
  value === undefined ? undefined : readString(value, fail);

export const readOptionalBoolean = (value: unknown, fail: FailWorkflow): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    fail('INVALID_VALUE');
  }

  return value as boolean;
};

export const readPositiveInteger = (value: unknown, fail: FailWorkflow): number => {
  if (!isInteger(value) || (value as number) <= 0) {
    fail('INVALID_VALUE');
  }

  return value as number;
};

export const readOptionalPositiveInteger = (
  value: unknown,
  fail: FailWorkflow,
): number | undefined => (value === undefined ? undefined : readPositiveInteger(value, fail));

/**
 * Reads one of a closed set of strings, or the declared default. The set is the node type's own
 * vocabulary, so the failure is an authoring error rather than a client one.
 */
export const readEnum = <TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  fallback: TValue,
  fail: FailWorkflow,
): TValue => {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== 'string' || !allowed.includes(value as TValue)) {
    fail('INVALID_VALUE');
  }

  return value as TValue;
};

export const readStringList = (value: unknown, fail: FailWorkflow): readonly string[] => {
  if (!Array.isArray(value) || value.length === 0) {
    fail('INVALID_VALUE');
  }

  return (value as readonly unknown[]).map((entry) => readString(entry, fail));
};

/**
 * Reads a hand-written field map from `form`'s or `custom-step`'s config. Only the shape is checked
 * here: what a descriptor may carry is the field normalizer's authority, and re-deciding it here
 * would only let the two disagree.
 */
export const readFieldMap = (
  value: unknown,
  fail: FailWorkflow,
): Readonly<Record<string, RawWorkflowField>> => {
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    fail('INVALID_VALUE');
  }

  for (const descriptor of Object.values(value as Record<string, unknown>)) {
    if (!isPlainObject(descriptor)) {
      fail('INVALID_VALUE');
    }
  }

  return value as Record<string, RawWorkflowField>;
};

export const readCondition = (value: unknown, fail: FailWorkflow): RawWorkflowCondition => {
  if (!isPlainObject(value)) {
    fail('INVALID_VALUE');
  }

  return value as RawWorkflowCondition;
};

/**
 * Schema fragment for a hand-written field map. Points at the same descriptor union the step
 * schema validates step data against, so a typo in a `form`'s field is a schema error naming the
 * property rather than a normalization failure naming only a reason code.
 */
export const fieldMapSchema = (): JsonSchemaFragment => ({
  type: 'object',
  minProperties: 1,
  propertyNames: { $ref: '#/definitions/safeName' },
  additionalProperties: { $ref: '#/definitions/rootFieldDescriptor' },
});

export const nonEmptyStringSchema = (): JsonSchemaFragment => ({ type: 'string', minLength: 1 });

/** The adapter a node's connector declaration names, resolved over the node type's own defaults. */
export type NodeConnectorBinding = {
  readonly name: string;
  readonly id: string;
  readonly type: ConnectorType;
};

export type NodeConnectorDefaults = {
  readonly id?: string;
  readonly type: ConnectorType;
};

/**
 * Reads a node's `connector` block. `type` defaults to the capability the node type needs, because
 * a node asking for a `kyc` connector already knows that much — the author only has to say which
 * provider fills the slot. `name` defaults to `id`, so a document naming one adapter once is not
 * made to name it twice.
 *
 * Keys beyond those three are ignored here: the block also carries whatever provider-specific
 * settings the node type declared through `connectorBindingSchema`, and the node type reads those
 * itself. The schema is what refuses a key nobody claims.
 */
export const readConnectorBinding = (
  value: unknown,
  defaults: NodeConnectorDefaults,
  fail: FailWorkflow,
): NodeConnectorBinding => {
  const source = value === undefined ? {} : value;

  if (!isPlainObject(source)) {
    fail('INVALID_VALUE');
  }

  const declared = source as Record<string, unknown>;
  const id = readOptionalString(declared.id, fail) ?? defaults.id;

  if (id === undefined) {
    fail('INVALID_VALUE');
  }

  const type = declared.type ?? defaults.type;

  if (!CONNECTOR_TYPES.includes(type as ConnectorType)) {
    fail('INVALID_VALUE');
  }

  return {
    name: readOptionalString(declared.name, fail) ?? (id as string),
    id: id as string,
    type: type as ConnectorType,
  };
};

export type ConnectorBindingSchemaOptions = {
  /** True when the node type has no default adapter, so the author must name one. */
  readonly idRequired: boolean;
  /**
   * Provider-specific settings kept inside the same block that names the provider — an author
   * choosing an adapter and describing how to call it writes one object, not two that have to be
   * read together.
   */
  readonly extraProperties?: Readonly<Record<string, JsonSchemaFragment>>;
};

/**
 * The schema for a node's `connector` block. Declares `id` required whenever `parseConfig` would
 * refuse its absence, so a node that names no provider fails at the schema, pointing at the key,
 * rather than in parsing with only a reason code.
 */
export const connectorBindingSchema = (
  options: ConnectorBindingSchemaOptions,
): JsonSchemaFragment => ({
  type: 'object',
  additionalProperties: false,
  ...(options.idRequired ? { required: ['id'] } : {}),
  properties: {
    name: nonEmptyStringSchema(),
    id: nonEmptyStringSchema(),
    type: { enum: [...CONNECTOR_TYPES] },
    ...(options.extraProperties ?? {}),
  },
});

/** Reads a pass-through config object handed to an adapter verbatim. */
export const readAdapterConfig = (
  value: unknown,
  fail: FailWorkflow,
): Readonly<Record<string, unknown>> => {
  if (value === undefined) {
    return {};
  }

  if (!isPlainObject(value)) {
    fail('INVALID_VALUE');
  }

  return value as Record<string, unknown>;
};
