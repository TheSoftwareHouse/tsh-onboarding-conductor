import { isInteger, isPlainObject } from '../../value-guards';
import type { CompiledWorkflowStep, RawWorkflowTransition } from '../../workflow-contract';
import {
  asConfigObject,
  buildFailurePolicy,
  connectorBindingSchema,
  mergeDerivedWithExtras,
  readConnectorBinding,
  readEnum,
  readOptionalBoolean,
  readPositiveInteger,
  readStringList,
  type StepConnectorBinding,
  type StepConnectorSlot,
} from '../step-config.utils';
import { buildSuccessTransition } from '../step-compile.utils';
import { resolveUploadValidation, uploadValidationSchema } from '../presets/upload.preset';
import type {
  CanonicalFieldRole,
  FailWorkflow,
  FileValidation,
  JsonSchemaFragment,
  StepFieldMap,
  WorkflowStepCompilationContext,
  WorkflowStepPort,
  WorkflowStepTypeDefinition,
} from '../step-type.port';

/**
 * The callback fields the parked step must declare, for the reason the KYC step spells out: the
 * engine re-submits the provider's callback body through the step that parked, so an undeclared
 * key loses the verdict. Field names are unique across a document, so a document holds at most one
 * of these steps. The kernel emits these exact keys.
 */
export const CREDIT_OUTCOME_FIELD = 'creditOutcome';
export const CREDIT_BANK_DATA_FIELD = 'bankData';

/** Must equal `CREDIT_OUTCOMES` in `workflow-contract.ts`. */
export const CREDIT_APPROVED_PORT = 'approved';
export const CREDIT_REVIEW_PORT = 'review';
export const CREDIT_DECLINED_PORT = 'declined';
export const CREDIT_RETRY_PORT = 'retry';
const CREDIT_PORT_NAMES = [
  CREDIT_APPROVED_PORT,
  CREDIT_REVIEW_PORT,
  CREDIT_DECLINED_PORT,
  CREDIT_RETRY_PORT,
] as const;

const CREDIT_SCORE_BANDS = ['approve', 'review', 'decline'] as const;

/** Applicant attributes a credit provider may be told, each opted into by the author. */
const CREDIT_APPLICANT_ROLES = [
  'firstName',
  'lastName',
  'email',
] as const satisfies readonly CanonicalFieldRole[];

const CREDIT_REPORT_MODES = ['full', 'summary', 'none'] as const;
export type CreditReportMode = (typeof CREDIT_REPORT_MODES)[number];

const DEFAULT_APPROVE_FROM = 700;
const DEFAULT_REVIEW_FROM = 400;
const MAX_BAND_SCORE = 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_PRODUCTS: readonly string[] = ['creditScore', 'paymentScore'];
const DEFAULT_BANK_DATA_MAX_BYTES = 1024 * 1024;

const CREDIT_CONNECTOR_SLOT: StepConnectorSlot = { types: ['credit'], extras: 'none' };

export type CreditAssessmentStepConfig = {
  readonly connector: StepConnectorBinding;
  readonly bands: { readonly approveFrom: number; readonly reviewFrom: number };
  readonly maxAttempts: number;
  readonly applicant: readonly (typeof CREDIT_APPLICANT_ROLES)[number][];
  readonly products: readonly string[];
  readonly report: CreditReportMode;
  readonly bankData: FileValidation;
};

const readBandScore = (value: unknown, fallback: number, fail: FailWorkflow): number => {
  const score = value ?? fallback;

  if (!isInteger(score) || (score as number) < 0 || (score as number) > MAX_BAND_SCORE) {
    fail('INVALID_VALUE');
  }

  return score as number;
};

const readBands = (value: unknown, fail: FailWorkflow): CreditAssessmentStepConfig['bands'] => {
  if (value !== undefined && !isPlainObject(value)) {
    fail('INVALID_VALUE');
  }

  const source = (value ?? {}) as Record<string, unknown>;
  const approveFrom = readBandScore(source.approveFrom, DEFAULT_APPROVE_FROM, fail);
  const reviewFrom = readBandScore(source.reviewFrom, DEFAULT_REVIEW_FROM, fail);

  // A score cannot be both approvable and only reviewable.
  if (approveFrom <= reviewFrom) {
    fail('INVALID_VALUE');
  }

  return { approveFrom, reviewFrom };
};

const readApplicant = (
  value: unknown,
  fail: FailWorkflow,
): CreditAssessmentStepConfig['applicant'] => {
  if (value === undefined) {
    return [];
  }

  if (!isPlainObject(value)) {
    fail('INVALID_VALUE');
  }

  const source = value as Record<string, unknown>;

  for (const key of Object.keys(source)) {
    if (!(CREDIT_APPLICANT_ROLES as readonly string[]).includes(key)) {
      fail('INVALID_VALUE');
    }
  }

  return CREDIT_APPLICANT_ROLES.filter((role) => readOptionalBoolean(source[role], fail) === true);
};

/**
 * Submitting a bank-data document to a credit provider and routing on the assessed outcome. The
 * step owns the one input the client gives it — the uploaded `bankData` file — and declares every
 * field the provider's callback fills, so the author names the provider, the score bands and the
 * attempt cap, and wires four ports.
 */
export const creditAssessmentStepTypeDefinition = {
  type: 'credit-assessment',
  category: 'verify',
  connectorSlot: CREDIT_CONNECTOR_SLOT,
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['connector'],
      properties: {
        connector: connectorBindingSchema(CREDIT_CONNECTOR_SLOT),
        bands: {
          type: 'object',
          additionalProperties: false,
          properties: {
            approveFrom: { type: 'integer', minimum: 0, maximum: MAX_BAND_SCORE },
            reviewFrom: { type: 'integer', minimum: 0, maximum: MAX_BAND_SCORE },
          },
        },
        maxAttempts: { type: 'integer', minimum: 1 },
        applicant: {
          type: 'object',
          additionalProperties: false,
          properties: Object.fromEntries(
            CREDIT_APPLICANT_ROLES.map((role) => [role, { type: 'boolean' }]),
          ),
        },
        products: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
        report: { enum: [...CREDIT_REPORT_MODES] },
        bankDataMaxSizeBytes: uploadValidationSchema().maxSizeBytes,
      },
    };
  },
  parseConfig(config, fail): CreditAssessmentStepConfig {
    const source = asConfigObject(config, fail);

    return {
      connector: readConnectorBinding(source.connector, CREDIT_CONNECTOR_SLOT, fail),
      bands: readBands(source.bands, fail),
      maxAttempts:
        source.maxAttempts === undefined
          ? DEFAULT_MAX_ATTEMPTS
          : readPositiveInteger(source.maxAttempts, fail),
      applicant: readApplicant(source.applicant, fail),
      products:
        source.products === undefined ? DEFAULT_PRODUCTS : readStringList(source.products, fail),
      report: readEnum(source.report, CREDIT_REPORT_MODES, 'full', fail),
      bankData: resolveUploadValidation(
        ['application/json'],
        source.bankDataMaxSizeBytes ?? DEFAULT_BANK_DATA_MAX_BYTES,
        ['application/json'],
        fail,
      ),
    };
  },
  listPorts(): readonly WorkflowStepPort[] {
    return CREDIT_PORT_NAMES.map((name) => ({ name }));
  },
  listSubStepKeys(): readonly (string | null)[] {
    return [null];
  },
  buildFields(config: CreditAssessmentStepConfig): StepFieldMap {
    return {
      [CREDIT_BANK_DATA_FIELD]: { type: 'file', required: true, validation: config.bankData },
      [CREDIT_OUTCOME_FIELD]: {
        type: 'text',
        required: false,
        clientVisible: true,
        validation: { oneOf: [...CREDIT_PORT_NAMES] },
      },
      creditScore: { type: 'number', required: false, clientVisible: true },
      creditScoreBand: {
        type: 'text',
        required: false,
        clientVisible: true,
        validation: { oneOf: [...CREDIT_SCORE_BANDS] },
      },
      creditIndicators: { type: 'json', required: false, clientVisible: true },
      creditSecondaryScores: { type: 'json', required: false, clientVisible: true },
      creditReasonCodes: { type: 'array', required: false, items: { type: 'text' } },
      creditAttemptCount: { type: 'number', required: false, clientVisible: true },
      creditProviderReference: { type: 'text', required: false },
      creditReport: { type: 'json', required: false, clientVisible: true },
    };
  },
  compile(
    context: WorkflowStepCompilationContext<CreditAssessmentStepConfig>,
  ): CompiledWorkflowStep[] {
    const { config, contract, fail } = context;
    const fieldMapping: Record<string, string> = {
      [CREDIT_BANK_DATA_FIELD]: CREDIT_BANK_DATA_FIELD,
    };

    for (const role of config.applicant) {
      // Opted into but collected by no earlier step: an authoring gap, caught at load.
      fieldMapping[role] = contract.canonicalFields[role] ?? fail('INVALID_VALUE');
    }

    const derivedConfig = {
      bands: { ...config.bands },
      maxAttempts: config.maxAttempts,
      products: [...config.products],
      report: config.report,
    };

    const arm = (port: string): RawWorkflowTransition => ({
      status: 'success',
      when: { field: CREDIT_OUTCOME_FIELD, equals: port },
      target: context.targets[port],
    });

    return [
      {
        name: context.stepNames[0],
        status: 'awaiting_user',
        data: context.fields,
        connectors: [
          {
            name: config.connector.name,
            id: config.connector.id,
            type: config.connector.type,
            // The provider answers on a callback, not in this request: the step parks.
            async: true,
            order: 1,
            fieldMapping: mergeDerivedWithExtras(fieldMapping, config.connector.fieldMapping, fail),
            config: mergeDerivedWithExtras(derivedConfig, config.connector.config, fail),
            ...buildFailurePolicy(config.connector, (entry) => ({
              fieldMapping: mergeDerivedWithExtras(
                fieldMapping,
                entry.fieldMapping ?? config.connector.fieldMapping,
                fail,
              ),
              config: mergeDerivedWithExtras(derivedConfig, entry.config ?? {}, fail),
            })),
          },
        ],
        transitions: [
          arm(CREDIT_APPROVED_PORT),
          arm(CREDIT_DECLINED_PORT),
          arm(CREDIT_RETRY_PORT),
          // Unconditional and last: anything the arms above did not claim is a human's call.
          buildSuccessTransition(context.targets[CREDIT_REVIEW_PORT]),
        ],
      },
    ];
  },
} as const satisfies WorkflowStepTypeDefinition<CreditAssessmentStepConfig>;
