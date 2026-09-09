import { isPlainObject } from '../../value-guards';
import type { RawWorkflowStep } from '../../workflow-contract';
import {
  asConfigObject,
  connectorBindingSchema,
  readAdapterConfig,
  readConnectorBinding,
  type NodeConnectorBinding,
  type NodeConnectorSlot,
} from '../node-config.utils';
import {
  compileSingleOutcomeStep,
  SINGLE_OUTCOME_PORTS,
  SINGLE_STEP_KEYS,
} from '../node-step.utils';
import type {
  FailWorkflow,
  JsonSchemaFragment,
  NodeFieldMap,
  WorkflowNodeCompilationContext,
  WorkflowNodePort,
  WorkflowNodeTypeDefinition,
} from '../node-type.port';

/**
 * The slot: the adapter that speaks plain JSON over HTTP has no capability of its own, so `custom`
 * is the only type that fits, and `http_request` fills it unless the author names another. The
 * request template is this node's own passthrough, and the adapter refuses config sections it does
 * not know, so the binding carries no additions.
 */
const HTTP_CONNECTOR_SLOT: NodeConnectorSlot = {
  types: ['custom'],
  defaultId: 'http_request',
  extras: 'none',
};

/**
 * Matches the placeholder grammar `http-request-template.ts` parses, narrowed to the payload
 * namespace: every `{{payload.<key>}}` the request url, headers, query or body references.
 */
const PAYLOAD_PLACEHOLDER_PATTERN = /\{\{\s*payload\.([A-Za-z0-9_-]+)\s*\}\}/g;

export type HttpCallNodeConfig = {
  readonly connector: NodeConnectorBinding;
  readonly request: Readonly<Record<string, unknown>>;
  readonly response?: Readonly<Record<string, unknown>>;
  /** Declared only when a payload key reads from a differently named field. */
  readonly fieldMapping?: Readonly<Record<string, string>>;
};

/** Every payload key the request template references, in first-seen order. */
export const collectPayloadPlaceholders = (
  value: unknown,
  keys: Set<string> = new Set(),
): Set<string> => {
  if (typeof value === 'string') {
    for (const match of value.matchAll(PAYLOAD_PLACEHOLDER_PATTERN)) {
      keys.add(match[1]);
    }

    return keys;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPayloadPlaceholders(entry, keys);
    }

    return keys;
  }

  if (isPlainObject(value)) {
    for (const entry of Object.values(value)) {
      collectPayloadPlaceholders(entry, keys);
    }
  }

  return keys;
};

const readFieldMappingOverride = (
  value: unknown,
  fail: FailWorkflow,
): Readonly<Record<string, string>> | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    fail('INVALID_VALUE');
  }

  for (const source of Object.values(value as Record<string, unknown>)) {
    if (typeof source !== 'string' || source.trim().length === 0) {
      fail('INVALID_VALUE');
    }
  }

  return value as Record<string, string>;
};

/**
 * Calling an arbitrary JSON-over-HTTP endpoint — provisioning an account, notifying a core banking
 * system, anything with no adapter of its own.
 *
 * The mapping is derived from the request template rather than declared beside it. A hand-written
 * declaration has to keep two lists in step: the `{{payload.*}}` placeholders and the
 * `fieldMapping` that feeds them, and a placeholder with no mapping fails at startup with nothing
 * pointing at the omission. Here the template is the single source, and an author only writes a
 * mapping when a payload key deliberately reads from a differently named field.
 */
export const httpCallNodeTypeDefinition = {
  type: 'http-call',
  category: 'integrate',
  connectorSlot: HTTP_CONNECTOR_SLOT,
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['request'],
      properties: {
        connector: connectorBindingSchema(HTTP_CONNECTOR_SLOT),
        request: { type: 'object' },
        response: { type: 'object' },
        fieldMapping: {
          type: 'object',
          minProperties: 1,
          propertyNames: { minLength: 1 },
          additionalProperties: { type: 'string', minLength: 1 },
        },
      },
    };
  },
  parseConfig(config, fail): HttpCallNodeConfig {
    const source = asConfigObject(config, fail);
    const request = readAdapterConfig(source.request, fail);

    if (Object.keys(request).length === 0) {
      fail('INVALID_VALUE');
    }

    return {
      connector: readConnectorBinding(source.connector, HTTP_CONNECTOR_SLOT, fail),
      request,
      response:
        source.response === undefined ? undefined : readAdapterConfig(source.response, fail),
      fieldMapping: readFieldMappingOverride(source.fieldMapping, fail),
    };
  },
  listPorts(): readonly WorkflowNodePort[] {
    return SINGLE_OUTCOME_PORTS;
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(): NodeFieldMap {
    return {};
  },
  compile(context: WorkflowNodeCompilationContext<HttpCallNodeConfig>): RawWorkflowStep[] {
    const { config } = context;
    // Only the request is a template — `http-request-config.ts` resolves references in its url,
    // headers, query and body and nowhere else — so only the request can create a mapping.
    const placeholders = collectPayloadPlaceholders(config.request);
    const fieldMapping: Record<string, string> = {};

    for (const payloadKey of placeholders) {
      fieldMapping[payloadKey] = config.fieldMapping?.[payloadKey] ?? payloadKey;
    }

    // A declared mapping for a key the template never references would silently do nothing.
    for (const payloadKey of Object.keys(config.fieldMapping ?? {})) {
      if (!placeholders.has(payloadKey)) {
        context.fail('INVALID_VALUE');
      }
    }

    const [step] = compileSingleOutcomeStep(context);

    return [
      {
        ...step,
        connectors: [
          {
            name: config.connector.name,
            id: config.connector.id,
            type: config.connector.type,
            order: 1,
            fieldMapping,
            config: {
              request: config.request,
              ...(config.response === undefined ? {} : { response: config.response }),
            },
          },
        ],
      },
    ];
  },
} as const satisfies WorkflowNodeTypeDefinition<HttpCallNodeConfig>;
