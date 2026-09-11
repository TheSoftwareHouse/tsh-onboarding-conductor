import { isInteger, isPlainObject } from '../value-guards';
import type { RawWorkflowCondition } from '../workflow-condition';
import {
  MAX_CONNECTOR_FALLBACK_CHAIN_LENGTH,
  type ConnectorType,
  type RawWorkflowConnectorDeclaration,
  type RawWorkflowConnectorFallbackDeclaration,
  type RawWorkflowConnectorRetryDeclaration,
  type RawWorkflowField,
} from '../workflow-contract';
import type { FailWorkflow, JsonSchemaFragment } from './step-type.port';

/** The port every step with exactly one outcome exposes. */
export const SUCCESS_PORT = 'success';

/** The port a step routes to when no other arm claimed the submit. */
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
 * Reads one of a closed set of strings, or the declared default. The set is the step type's own
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
 * Reads a hand-written field map from `form`'s or `custom`'s config. Only the shape is checked
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

/**
 * Reads a list of hand-written objects — connector declarations, transitions, scoring rules —
 * from a `custom` or `connector-call` config. Shape only: the entries are validated as the
 * compiled form's own by the schema definitions they are declared against, and normalized by the same
 * code a compiled step goes through.
 */
export const readObjectList = <TEntry>(value: unknown, fail: FailWorkflow): readonly TEntry[] => {
  if (!Array.isArray(value)) {
    fail('INVALID_VALUE');
  }

  for (const entry of value as readonly unknown[]) {
    if (!isPlainObject(entry)) {
      fail('INVALID_VALUE');
    }
  }

  return value as readonly TEntry[];
};

export const readCondition = (value: unknown, fail: FailWorkflow): RawWorkflowCondition => {
  if (!isPlainObject(value)) {
    fail('INVALID_VALUE');
  }

  return value as RawWorkflowCondition;
};

/**
 * A port the author names — a `decision` branch, a `risk-score` band. It becomes a key in `edges`
 * and in the compiler's port map, so it passes `safeName` like every other name a document
 * invents: `__proto__` is not merely confusing there, a plain object cannot hold it at all.
 */
export const portNameSchema = (): JsonSchemaFragment => ({ $ref: '#/definitions/safeName' });

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
 * One provider to try once the one before it has run out of attempts, as the author declared it
 * under the binding's `fallback`. The type-derived keys are not here — the step type re-derives
 * them for every entry — only what the author added beside them, and `source` for whatever
 * provider-specific settings the slot's `extraProperties` let the entry carry.
 */
export type StepConnectorFallbackBinding = {
  readonly name: string;
  readonly id: string;
  readonly type: ConnectorType;
  /** Payload keys added beside the derived ones. Absent, the entry inherits the primary's additions. */
  readonly fieldMapping?: Readonly<Record<string, string>>;
  /** Adapter config added beside the derived one. Absent, the entry carries the derived config alone. */
  readonly config?: Readonly<Record<string, unknown>>;
  readonly retry?: RawWorkflowConnectorRetryDeclaration;
  /** The entry as declared, for the settings a step type reads itself. */
  readonly source: Readonly<Record<string, unknown>>;
};

/**
 * The adapter a step's connector declaration names, resolved over the slot the step type declares,
 * plus whatever the author adds to what the type derives — and the failure policy of the slot:
 * which handler decides what an adapter's throw means, how often to retry, and which providers to
 * fall through to. The policy is the compiled form's own vocabulary, carried onto the declaration the
 * type emits, so a step is never less resilient than the step it compiles to.
 */
export type StepConnectorBinding = {
  readonly name: string;
  readonly id: string;
  readonly type: ConnectorType;
  /** Payload keys the author adds beyond what the step type derives, each naming a source field. */
  readonly fieldMapping: Readonly<Record<string, string>>;
  /** Adapter config the author adds beyond what the step type derives. */
  readonly config: Readonly<Record<string, unknown>>;
  readonly errorHandler?: string;
  readonly retry?: RawWorkflowConnectorRetryDeclaration;
  /** The chain behind the primary, in declared order. Empty when none was declared. */
  readonly fallbacks: readonly StepConnectorFallbackBinding[];
};

/**
 * What a step type's connector slot accepts. `types` is the binding between a step and the
 * connectors that can fill it: an OTP challenge is served by a `phone_verification` or an
 * `email_verification` adapter and by nothing else, and declaring one of another capability is an
 * authoring error the schema refuses — a builder reads the same list to offer only matching
 * connectors. The engine closes the loop at startup by refusing a declared type that disagrees with
 * the adapter registered under the `id`.
 */
export type StepConnectorSlot = {
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

const readRetry = (
  value: unknown,
  fail: FailWorkflow,
): RawWorkflowConnectorRetryDeclaration | undefined => {
  if (value === undefined) {
    return undefined;
  }

  // The bounds are the step normalizer's to enforce, exactly as for a hand-written declaration.
  if (!isPlainObject(value)) {
    fail('INVALID_VALUE');
  }

  return value as RawWorkflowConnectorRetryDeclaration;
};

const readFallbackBinding = (
  value: unknown,
  primaryType: ConnectorType,
  slot: StepConnectorSlot,
  fail: FailWorkflow,
): StepConnectorFallbackBinding => {
  if (!isPlainObject(value)) {
    fail('INVALID_VALUE');
  }

  const declared = value as Record<string, unknown>;
  const id = readString(declared.id, fail);
  const type = declared.type ?? primaryType;

  // A fallback stands in for the primary in the same slot, so it must be the same kind of thing.
  if (type !== primaryType) {
    fail('INVALID_VALUE');
  }

  return {
    name: readOptionalString(declared.name, fail) ?? id,
    id,
    type: type as ConnectorType,
    ...(slot.extras === 'none' || declared.fieldMapping === undefined
      ? {}
      : { fieldMapping: readExtraFieldMapping(declared.fieldMapping, fail) }),
    ...(slot.extras !== 'all' || declared.config === undefined
      ? {}
      : { config: readAdapterConfig(declared.config, fail) }),
    ...(declared.retry === undefined ? {} : { retry: readRetry(declared.retry, fail) }),
    source: declared,
  };
};

/**
 * Reads a step's `connector` block against the slot its type declares. `name` defaults to `id`, so a
 * document naming one adapter once is not made to name it twice.
 *
 * Keys beyond the binding's own are ignored here: the block may also carry provider-specific
 * settings the step type declared through `connectorBindingSchema`, and the step type reads those
 * itself. The schema is what refuses a key nobody claims.
 */
export const readConnectorBinding = (
  value: unknown,
  slot: StepConnectorSlot,
  fail: FailWorkflow,
): StepConnectorBinding => {
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

  const fallback = declared.fallback;

  if (
    fallback !== undefined &&
    (!Array.isArray(fallback) ||
      fallback.length === 0 ||
      fallback.length > MAX_CONNECTOR_FALLBACK_CHAIN_LENGTH)
  ) {
    fail('INVALID_VALUE');
  }

  return {
    name: readOptionalString(declared.name, fail) ?? (id as string),
    id: id as string,
    type: type as ConnectorType,
    fieldMapping: slot.extras === 'none' ? {} : readExtraFieldMapping(declared.fieldMapping, fail),
    config: slot.extras === 'all' ? readAdapterConfig(declared.config, fail) : {},
    ...(declared.errorHandler === undefined
      ? {}
      : { errorHandler: readString(declared.errorHandler, fail) }),
    ...(declared.retry === undefined ? {} : { retry: readRetry(declared.retry, fail) }),
    fallbacks: ((fallback as readonly unknown[] | undefined) ?? []).map((entry) =>
      readFallbackBinding(entry, type as ConnectorType, slot, fail),
    ),
  };
};

/**
 * Lays the author's additions under what the step type derived. A key both name is refused rather
 * than one silently winning: the derived key is what makes the step mean what it says, and an
 * addition that overrides it is a `custom` in disguise.
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

/** What a step type derives for one provider in its slot: the payload keys and the adapter config. */
export type DerivedConnectorDeclaration = {
  readonly fieldMapping: Readonly<Record<string, string>>;
  readonly optionalFieldMapping?: Readonly<Record<string, string>>;
  readonly config?: Readonly<Record<string, unknown>>;
};

/**
 * The failure policy a binding declared, as the members a connector declaration carries them:
 * `errorHandler` and `retry` verbatim, and one fallback entry per provider in the chain. Each
 * entry's mapping and config come from `deriveEntry`, because what the type derives is the same
 * for every provider in the slot while what the author added may differ per entry — that is what
 * lets an SMTP fallback name the template an email API's primary never needed.
 */
export const buildFailurePolicy = (
  binding: StepConnectorBinding,
  deriveEntry: (entry: StepConnectorFallbackBinding) => DerivedConnectorDeclaration,
): Pick<RawWorkflowConnectorDeclaration, 'errorHandler' | 'retry' | 'fallback'> => ({
  ...(binding.errorHandler === undefined ? {} : { errorHandler: binding.errorHandler }),
  ...(binding.retry === undefined ? {} : { retry: { ...binding.retry } }),
  ...(binding.fallbacks.length === 0
    ? {}
    : {
        fallback: binding.fallbacks.map((entry): RawWorkflowConnectorFallbackDeclaration => {
          const derived = deriveEntry(entry);

          return {
            name: entry.name,
            id: entry.id,
            type: entry.type,
            fieldMapping: { ...derived.fieldMapping },
            ...(derived.optionalFieldMapping === undefined
              ? {}
              : { optionalFieldMapping: { ...derived.optionalFieldMapping } }),
            ...(derived.config === undefined || Object.keys(derived.config).length === 0
              ? {}
              : { config: { ...derived.config } }),
            ...(entry.retry === undefined ? {} : { retry: { ...entry.retry } }),
          };
        }),
      }),
});

/**
 * The schema for a step's `connector` block, from the slot: `type` is the slot's own enum, `id` is
 * required when the slot names no default, and the additions the slot allows are the only ones
 * present. `extraProperties` keeps provider-specific settings inside the same block that names the
 * provider — an author choosing an adapter and describing how to call it writes one object — and
 * every fallback entry may carry them too, since a stand-in provider is called the same way.
 */
export const connectorBindingSchema = (
  slot: StepConnectorSlot,
  extraProperties: Readonly<Record<string, JsonSchemaFragment>> = {},
): JsonSchemaFragment => {
  const additions: Record<string, JsonSchemaFragment> = {
    ...(slot.extras === 'none'
      ? {}
      : { fieldMapping: { $ref: '#/definitions/connectorFieldMapping' } }),
    ...(slot.extras === 'all' ? { config: { $ref: '#/definitions/connectorConfig' } } : {}),
    ...extraProperties,
  };

  return {
    type: 'object',
    additionalProperties: false,
    ...(slot.defaultId === undefined ? { required: ['id'] } : {}),
    properties: {
      name: nonEmptyStringSchema(),
      id: nonEmptyStringSchema(),
      type: { enum: [...slot.types] },
      ...additions,
      errorHandler: nonEmptyStringSchema(),
      retry: { $ref: '#/definitions/connectorRetry' },
      fallback: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_CONNECTOR_FALLBACK_CHAIN_LENGTH,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: {
            name: nonEmptyStringSchema(),
            id: nonEmptyStringSchema(),
            type: { enum: [...slot.types] },
            ...additions,
            retry: { $ref: '#/definitions/connectorRetry' },
          },
        },
      },
    },
  };
};

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
