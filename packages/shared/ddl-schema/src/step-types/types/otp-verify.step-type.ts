import {
  CONNECTOR_REJECTION_REASONS,
  type ConnectorRejectionReason,
  type ConnectorType,
  type RawWorkflowConnectorDeclaration,
  type CompiledWorkflowStep,
} from '../../workflow-contract';
import {
  asConfigObject,
  buildFailurePolicy,
  connectorBindingSchema,
  mergeDerivedWithExtras,
  readConnectorBinding,
  readEnum,
  readOptionalString,
  type StepConnectorBinding,
  type StepConnectorSlot,
} from '../step-config.utils';
import { buildSuccessTransition } from '../step-compile.utils';
import type {
  CanonicalFieldRole,
  FailWorkflow,
  JsonSchemaFragment,
  StepFieldMap,
  WorkflowStepCompilationContext,
  WorkflowStepPort,
  WorkflowStepTypeDefinition,
} from '../step-type.port';

/** The channel the one-time code travels over. */
export const OTP_CHANNELS = ['sms', 'email'] as const;

export type OtpChannelName = (typeof OTP_CHANNELS)[number];

/** What an `otp_verification` connector is asked to do: deliver a fresh code, or check one. */
export const OTP_OPERATIONS = { send: 'send', check: 'check' } as const;

export type OtpOperation = (typeof OTP_OPERATIONS)[keyof typeof OTP_OPERATIONS];

/** The keys of the config this type derives onto every declaration it emits. */
export const OTP_CONFIG_KEYS = { operation: 'operation', channel: 'channel' } as const;

/**
 * The payload keys every verification adapter in this repository agrees on. Fixed rather than
 * config-driven because they name the two things an OTP challenge is made of, and a provider that called them something else would need
 * its own adapter anyway.
 */
const RECIPIENT_PAYLOAD_KEY = 'recipient';
const CODE_PAYLOAD_KEY = 'code';

const DEFAULT_CODE_FIELD = 'verificationCode';

/** Four to ten digits: every provider's code length in this range, with none of them assumed. */
const DEFAULT_CODE_PATTERN = '^[0-9]{4,10}$';

/**
 * The refusals that mean "the attempt went stale", not "this person is refused". Recovering from
 * them is the whole reason the resend step exists, and getting this set wrong is the difference
 * between a customer retyping a code and a customer being rejected for typing slowly.
 */
const DEFAULT_RESEND_REASONS: readonly ConnectorRejectionReason[] = [
  'CHALLENGE_EXPIRED',
  'CHALLENGE_NOT_FOUND',
];

/** Per channel: the canonical role that holds the recipient. */
const CHANNEL_DEFAULTS = {
  sms: { role: 'phoneNumber' },
  email: { role: 'email' },
} as const satisfies Record<OtpChannelName, { role: CanonicalFieldRole }>;

const OTP_CONNECTOR_TYPE: ConnectorType = 'otp_verification';

/**
 * The slot: only an adapter that proves a contact channel may fill it. The channel and the
 * operation are derived onto the declaration, so the author names the adapter and nothing else.
 */
const OTP_CONNECTOR_SLOT: StepConnectorSlot = {
  types: [OTP_CONNECTOR_TYPE],
  extras: 'fieldMapping',
};

export const OTP_VERIFIED_PORT = 'verified';
export const OTP_REFUSED_PORT = 'refused';

/** Sub-step keys: the entry step sends, then the pair that checks and re-sends. */
const OTP_SUB_STEP_KEYS = [null, 'verify', 'resend'] as const;

export type OtpVerifyStepConfig = {
  readonly channel: OtpChannelName;
  /** Names the field to challenge; absent, the channel's canonical role supplies it at compile. */
  readonly recipientField?: string;
  readonly codeField: string;
  readonly codePattern: string;
  readonly resendReasons: readonly ConnectorRejectionReason[];
  readonly connector: StepConnectorBinding;
};

const readResendReasons = (
  value: unknown,
  fail: FailWorkflow,
): readonly ConnectorRejectionReason[] => {
  if (value === undefined) {
    return DEFAULT_RESEND_REASONS;
  }

  if (!Array.isArray(value) || value.length === 0) {
    fail('INVALID_VALUE');
  }

  const reasons = value as readonly unknown[];

  for (const reason of reasons) {
    if (!CONNECTOR_REJECTION_REASONS.includes(reason as ConnectorRejectionReason)) {
      fail('INVALID_VALUE');
    }
  }

  if (new Set(reasons).size !== reasons.length) {
    fail('INVALID_VALUE');
  }

  return reasons as readonly ConnectorRejectionReason[];
};

const buildConnector = (
  config: OtpVerifyStepConfig,
  recipientField: string,
  operation: OtpOperation,
  fail: FailWorkflow,
): RawWorkflowConnectorDeclaration => {
  const { connector } = config;
  const adapterConfig = {
    [OTP_CONFIG_KEYS.operation]: operation,
    [OTP_CONFIG_KEYS.channel]: config.channel,
  };
  const derived: Record<string, string> = { [RECIPIENT_PAYLOAD_KEY]: recipientField };

  if (operation === OTP_OPERATIONS.check) {
    derived[CODE_PAYLOAD_KEY] = config.codeField;
  }

  return {
    name: connector.name,
    id: connector.id,
    type: connector.type,
    // Only the check can refuse: a send either reaches the provider or fails as an integration error.
    ...(operation === OTP_OPERATIONS.check ? { canReject: true } : {}),
    order: 1,
    fieldMapping: mergeDerivedWithExtras(derived, connector.fieldMapping, fail),
    config: adapterConfig,
    ...buildFailurePolicy(connector, (entry) => ({
      fieldMapping: mergeDerivedWithExtras(
        derived,
        entry.fieldMapping ?? connector.fieldMapping,
        fail,
      ),
      config: adapterConfig,
    })),
  };
};

/**
 * Proving a contact channel with a one-time code, as three steps: send, check, re-send. The
 * hand-written form spent 153 lines and three separate step declarations on this, and the part
 * that is easy to get wrong is not the happy path — it is that a stale challenge has to route back
 * to a re-send instead of refusing the customer, and that the re-send has to hand them back to the
 * same check. Both of those edges are internal here, so an author wires only the two outcomes that
 * are theirs to decide: the code was right, or the person was refused.
 *
 * This step collects nothing. The number or address it challenges is whatever a collection step
 * before it — `contact-details`, or a `form` claiming the role — published under the channel's
 * canonical role, so collecting a contact and proving it stay two steps, and a canvas shows them
 * as two. The send step therefore carries no fields: the customer's submit on it is the request to
 * send the code.
 */
export const otpVerifyStepTypeDefinition = {
  type: 'otp-verify',
  category: 'verify',
  connectorSlot: OTP_CONNECTOR_SLOT,
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['connector'],
      properties: {
        channel: { enum: [...OTP_CHANNELS] },
        recipientField: { type: 'string', minLength: 1 },
        codeField: { type: 'string', minLength: 1 },
        codePattern: { type: 'string', minLength: 1 },
        resendReasons: {
          type: 'array',
          minItems: 1,
          uniqueItems: true,
          items: { enum: [...CONNECTOR_REJECTION_REASONS] },
        },
        connector: connectorBindingSchema(OTP_CONNECTOR_SLOT),
      },
    };
  },
  parseConfig(config, fail): OtpVerifyStepConfig {
    const source = asConfigObject(config, fail);
    const channel = readEnum(source.channel, OTP_CHANNELS, 'sms', fail);

    return {
      channel,
      recipientField: readOptionalString(source.recipientField, fail),
      codeField: readOptionalString(source.codeField, fail) ?? DEFAULT_CODE_FIELD,
      codePattern: readOptionalString(source.codePattern, fail) ?? DEFAULT_CODE_PATTERN,
      resendReasons: readResendReasons(source.resendReasons, fail),
      connector: readConnectorBinding(source.connector, OTP_CONNECTOR_SLOT, fail),
    };
  },
  listPorts(): readonly WorkflowStepPort[] {
    return [{ name: OTP_VERIFIED_PORT }, { name: OTP_REFUSED_PORT }];
  },
  listSubStepKeys(): readonly (string | null)[] {
    return [...OTP_SUB_STEP_KEYS];
  },
  buildFields(): StepFieldMap {
    return {};
  },
  resolveScoringStepKey(): string {
    // The outcome is known on the check, not on the send: a rule such as "a proven number raises
    // trust" has to run there, and a rule on the send would fire before anything was proved.
    return OTP_SUB_STEP_KEYS[1];
  },
  compile(context: WorkflowStepCompilationContext<OtpVerifyStepConfig>): CompiledWorkflowStep[] {
    const { config, fail } = context;
    const [sendStep, verifyStep, resendStep] = context.stepNames;
    // Nothing before this step collects the channel it is meant to prove: an authoring gap, caught
    // at load rather than as a connector mapping that resolves to nothing.
    const recipientField =
      config.recipientField ??
      context.contract.canonicalFields[CHANNEL_DEFAULTS[config.channel].role] ??
      fail('INVALID_VALUE');

    return [
      {
        name: sendStep,
        status: 'awaiting_user',
        data: context.fields,
        connectors: [buildConnector(config, recipientField, OTP_OPERATIONS.send, fail)],
        transitions: [buildSuccessTransition(verifyStep)],
      },
      {
        name: verifyStep,
        status: 'awaiting_user',
        data: {
          // Never persisted: a spent code is evidence of nothing and a liability to keep.
          [config.codeField]: {
            type: 'text',
            required: true,
            persist: false,
            validation: { pattern: config.codePattern },
          },
        },
        connectors: [buildConnector(config, recipientField, OTP_OPERATIONS.check, fail)],
        transitions: [
          buildSuccessTransition(context.targets[OTP_VERIFIED_PORT]),
          { status: 'rejected', reason: [...config.resendReasons], target: resendStep },
          { status: 'rejected', target: context.targets[OTP_REFUSED_PORT] },
        ],
      },
      {
        name: resendStep,
        status: 'awaiting_user',
        data: {},
        connectors: [buildConnector(config, recipientField, OTP_OPERATIONS.send, fail)],
        transitions: [buildSuccessTransition(verifyStep)],
      },
    ];
  },
} as const satisfies WorkflowStepTypeDefinition<OtpVerifyStepConfig>;
