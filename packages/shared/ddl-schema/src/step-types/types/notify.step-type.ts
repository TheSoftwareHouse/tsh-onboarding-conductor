import type { CompiledWorkflowStep } from '../../workflow-contract';
import {
  asConfigObject,
  buildFailurePolicy,
  connectorBindingSchema,
  mergeDerivedWithExtras,
  readConnectorBinding,
  readString,
  type StepConnectorBinding,
  type StepConnectorSlot,
} from '../step-config.utils';
import {
  compileSingleOutcomeStep,
  SINGLE_OUTCOME_PORTS,
  SINGLE_STEP_KEYS,
} from '../step-compile.utils';
import type {
  JsonSchemaFragment,
  StepFieldMap,
  WorkflowStepCompilationContext,
  WorkflowStepPort,
  WorkflowStepTypeDefinition,
} from '../step-type.port';

/**
 * The payload key every delivery adapter in this repository reads the destination from —
 * `sendgrid_email` and `smtp` agree on it, which is what makes one step type
 * serve both.
 */
const RECIPIENT_PAYLOAD_KEY = 'recipient';

/**
 * The slot: a message is delivered by an `email_delivery` or `sms_delivery` adapter. Everything a
 * template interpolates and everything the adapter is configured with travels on the binding —
 * `fieldMapping` beside the derived `recipient`, and `config` — so a fallback provider can carry
 * its own of each: an SMTP stand-in names a template file an email API's primary never needed.
 */
const NOTIFY_CONNECTOR_SLOT: StepConnectorSlot = {
  types: ['email_delivery', 'sms_delivery'],
  defaultType: 'email_delivery',
  extras: 'all',
};

export type NotifyStepConfig = {
  readonly connector: StepConnectorBinding;
  readonly recipientField: string;
};

/**
 * Sending the applicant a message — a confirmation, a rejection notice, a nudge. Collects nothing
 * and decides nothing: it exists so a canvas can show that the customer was told, which is a
 * question a compliance reviewer asks and a hand-written connector declaration answers only if
 * you read its `fieldMapping`.
 */
export const notifyStepTypeDefinition = {
  type: 'notify',
  category: 'integrate',
  connectorSlot: NOTIFY_CONNECTOR_SLOT,
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['connector', 'recipientField'],
      properties: {
        connector: connectorBindingSchema(NOTIFY_CONNECTOR_SLOT),
        recipientField: { type: 'string', minLength: 1 },
      },
    };
  },
  parseConfig(config, fail): NotifyStepConfig {
    const source = asConfigObject(config, fail);

    return {
      connector: readConnectorBinding(source.connector, NOTIFY_CONNECTOR_SLOT, fail),
      recipientField: readString(source.recipientField, fail),
    };
  },
  listPorts(): readonly WorkflowStepPort[] {
    return SINGLE_OUTCOME_PORTS;
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(): StepFieldMap {
    return {};
  },
  compile(context: WorkflowStepCompilationContext<NotifyStepConfig>): CompiledWorkflowStep[] {
    const { connector, recipientField } = context.config;
    const { fail } = context;
    const [step] = compileSingleOutcomeStep(context);
    // The recipient has exactly one source. An addition naming it too could disagree with it, and
    // `mergeDerivedWithExtras` refuses the override rather than letting either win.
    const derived = { [RECIPIENT_PAYLOAD_KEY]: recipientField };

    return [
      {
        ...step,
        connectors: [
          {
            name: connector.name,
            id: connector.id,
            type: connector.type,
            order: 1,
            fieldMapping: mergeDerivedWithExtras(derived, connector.fieldMapping, fail),
            ...(Object.keys(connector.config).length === 0
              ? {}
              : { config: { ...connector.config } }),
            ...buildFailurePolicy(connector, (entry) => ({
              fieldMapping: mergeDerivedWithExtras(
                derived,
                entry.fieldMapping ?? connector.fieldMapping,
                fail,
              ),
              config: entry.config,
            })),
          },
        ],
      },
    ];
  },
} as const satisfies WorkflowStepTypeDefinition<NotifyStepConfig>;
