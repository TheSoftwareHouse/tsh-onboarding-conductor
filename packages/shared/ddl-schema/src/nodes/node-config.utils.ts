import { isInteger, isPlainObject } from '../value-guards';
import type { RawWorkflowCondition } from '../workflow-condition';
import type { ConnectorType, RawWorkflowField } from '../workflow-contract';
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

/**
 * The adapter a node's connector declaration names, resolved over the slot the node type declares,
 * plus whatever the author adds to what the type derives.
 */
export type NodeConnectorBinding = {
  readonly name: string;
  readonly id: string;
  readonly type: ConnectorType;
  /** Payload keys the author adds beyond what the node type derives, each naming a source field. */
  readonly fieldMapping: Readonly<Record<string, string>>;
  /** Adapter config the author adds beyond what the node type derives. */
  readonly config: Readonly<Record<string, unknown>>;
};

/**
 * What a node type's connector slot accepts. `types` is the binding between a node and the
 * connectors that can fill it: an OTP challenge is served by a `phone_verification` or an
 * `email_verification` adapter and by nothing else, and declaring one of another capability is an
 * authoring error the schema refuses — a builder reads the same list to offer only matching
 * connectors. The engine closes the loop at startup by refusing a declared type that disagrees with
 * the adapter registered under the `id`.
 */
export type NodeConnectorSlot = {
  readonly types: readonly ConnectorType[];
  /** The adapter used when none is named. Absent when the author has to choose one. */
  readonly defaultId?: string;
  /** The capability assumed when none is declared. Defaults to the slot's only type when it has one. */
  readonly defaultType?: ConnectorType;
  /**
   * Which additions the author may make beside what the type derives. `none` for a type whose
   * adapter refuses keys it does not know, or that has a passthrough of its own.
   */
  readonly extras: 'none' | 'fieldMapping' | 'all';
};

const readExtraFieldMapping = (
  value: unknown,
  fail: FailWorkflow,
): Readonly<Record<string, string>> => {
  if (value === undefined) {
    return {};
  }

  if (!isPlainObject(value)) {
    fail('INVALID_VALUE');
  }

  const mapping: Record<string, string> = {};

  for (const [payloadKey, sourceField] of Object.entries(value as Record<string, unknown>)) {
    mapping[payloadKey] = readString(sourceField, fail);
  }

  return mapping;
};

/**
 * Reads a node's `connector` block against the slot its type declares. `name` defaults to `id`, so a
 * document naming one adapter once is not made to name it twice.
 *
 * Keys beyond the binding's own are ignored here: the block may also carry provider-specific
 * settings the node type declared through `connectorBindingSchema`, and the node type reads those
 * itself. The schema is what refuses a key nobody claims.
 */
export const readConnectorBinding = (
  value: unknown,
  slot: NodeConnectorSlot,
  fail: FailWorkflow,
): NodeConnectorBinding => {
  const source = value === undefined ? {} : value;

  if (!isPlainObject(source)) {
    fail('INVALID_VALUE');
  }

  const declared = source as Record<string, unknown>;
  const id = readOptionalString(declared.id, fail) ?? slot.defaultId;

  if (id === undefined) {
    fail('INVALID_VALUE');
  }

  const type =
    declared.type ?? slot.defaultType ?? (slot.types.length === 1 ? slot.types[0] : undefined);

  if (type === undefined || !slot.types.includes(type as ConnectorType)) {
    fail('INVALID_VALUE');
  }

  return {
    name: readOptionalString(declared.name, fail) ?? (id as string),
    id: id as string,
    type: type as ConnectorType,
    fieldMapping: slot.extras === 'none' ? {} : readExtraFieldMapping(declared.fieldMapping, fail),
    config: slot.extras === 'all' ? readAdapterConfig(declared.config, fail) : {},
  };
};

/**
 * Lays the author's additions under what the node type derived. A key both name is refused rather
 * than one silently winning: the derived key is what makes the node mean what it says, and an
 * addition that overrides it is a `custom-step` in disguise.
 */
export const mergeDerivedWithExtras = <TValue>(
  derived: Readonly<Record<string, TValue>>,
  extras: Readonly<Record<string, TValue>>,
  fail: FailWorkflow,
): Record<string, TValue> => {
  for (const key of Object.keys(extras)) {
    if (Object.prototype.hasOwnProperty.call(derived, key)) {
      fail('INVALID_VALUE');
    }
  }

  return { ...derived, ...extras };
};

/**
 * The schema for a node's `connector` block, from the slot: `type` is the slot's own enum, `id` is
 * required when the slot names no default, and the additions the slot allows are the only ones
 * present. `extraProperties` keeps provider-specific settings inside the same block that names the
 * provider — an author choosing an adapter and describing how to call it writes one object.
 */
export const connectorBindingSchema = (
  slot: NodeConnectorSlot,
  extraProperties: Readonly<Record<string, JsonSchemaFragment>> = {},
): JsonSchemaFragment => ({
  type: 'object',
  additionalProperties: false,
  ...(slot.defaultId === undefined ? { required: ['id'] } : {}),
  properties: {
    name: nonEmptyStringSchema(),
    id: nonEmptyStringSchema(),
    type: { enum: [...slot.types] },
    ...(slot.extras === 'none'
      ? {}
      : {
          fieldMapping: {
            type: 'object',
            propertyNames: { minLength: 1 },
            additionalProperties: { type: 'string', minLength: 1 },
          },
        }),
    ...(slot.extras === 'all' ? { config: { type: 'object' } } : {}),
    ...extraProperties,
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
