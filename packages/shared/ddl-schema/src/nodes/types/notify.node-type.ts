import { isPlainObject } from '../../value-guards';
import type { RawWorkflowStep } from '../../workflow-contract';
import {
  asConfigObject,
  connectorBindingSchema,
  readAdapterConfig,
  readConnectorBinding,
  readString,
  type NodeConnectorBinding,
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
 * The payload key every delivery adapter in this repository reads the destination from —
 * `sendgrid_email`, `smtp` and `twilio_verify` all agree on it, which is what makes one node type
 * serve all three.
 */
const RECIPIENT_PAYLOAD_KEY = 'recipient';

export type NotifyNodeConfig = {
  readonly connector: NodeConnectorBinding;
  readonly recipientField: string;
  /** Payload key to source field, for everything the template interpolates. */
  readonly payload: Readonly<Record<string, string>>;
  readonly config: Readonly<Record<string, unknown>>;
};

const readPayloadMapping = (
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
    if (payloadKey === RECIPIENT_PAYLOAD_KEY) {
      // The recipient has its own config key; two sources for it could disagree.
      fail('INVALID_VALUE');
    }

    mapping[payloadKey] = readString(sourceField, fail);
  }

  return mapping;
};

/**
 * Sending the applicant a message — a confirmation, a rejection notice, a nudge. Collects nothing
 * and decides nothing: it exists so a canvas can show that the customer was told, which is a
 * question a compliance reviewer asks and a hand-written connector declaration answers only if
 * you read its `fieldMapping`.
 */
export const notifyNodeTypeDefinition = {
  type: 'notify',
  category: 'integrate',
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['connector', 'recipientField'],
      properties: {
        connector: connectorBindingSchema({ idRequired: true }),
        recipientField: { type: 'string', minLength: 1 },
        payload: {
          type: 'object',
          propertyNames: { minLength: 1 },
          additionalProperties: { type: 'string', minLength: 1 },
        },
        config: { type: 'object' },
      },
    };
  },
  parseConfig(config, fail): NotifyNodeConfig {
    const source = asConfigObject(config, fail);

    return {
      connector: readConnectorBinding(source.connector, { type: 'email_delivery' }, fail),
      recipientField: readString(source.recipientField, fail),
      payload: readPayloadMapping(source.payload, fail),
      config: readAdapterConfig(source.config, fail),
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
  compile(context: WorkflowNodeCompilationContext<NotifyNodeConfig>): RawWorkflowStep[] {
    const { config } = context;
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
            fieldMapping: {
              [RECIPIENT_PAYLOAD_KEY]: config.recipientField,
              ...config.payload,
            },
            ...(Object.keys(config.config).length === 0 ? {} : { config: { ...config.config } }),
          },
        ],
      },
    ];
  },
} as const satisfies WorkflowNodeTypeDefinition<NotifyNodeConfig>;
