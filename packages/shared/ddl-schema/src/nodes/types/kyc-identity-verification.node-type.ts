import {
  KYC_OUTCOMES,
  KYC_RETRY_TARGETS,
  type KycRetryTarget,
  type RawWorkflowStep,
  type RawWorkflowTransition,
} from '../../workflow-contract';
import {
  asConfigObject,
  connectorBindingSchema,
  mergeDerivedWithExtras,
  readConnectorBinding,
  readPositiveInteger,
  readString,
  type NodeConnectorBinding,
  type NodeConnectorSlot,
} from '../node-config.utils';
import { toDocumentPayloadKey } from '../node-naming';
import { buildSuccessTransition } from '../node-step.utils';
import type {
  CanonicalFieldRole,
  JsonSchemaFragment,
  NodeFieldMap,
  WorkflowNodeCompilationContext,
  WorkflowNodeContract,
  WorkflowNodePort,
  WorkflowNodeTypeDefinition,
} from '../node-type.port';

/**
 * The callback fields the parked step must declare. The engine re-submits the provider's callback
 * body through the step that parked, so an undeclared key is an `UNKNOWN` field error that loses
 * the verdict — the node owns all four rather than trusting an author to remember them.
 *
 * Because field names are unique across a whole document, only one step can declare this set, so a
 * document holds at most one of these nodes. The adapter emits these exact keys, so the limit
 * cannot be lifted by renaming them here.
 */
export const KYC_OUTCOME_FIELD = 'kycOutcome';
export const KYC_RETRY_STEP_FIELD = 'kycRetryStep';
const KYC_REASON_CODES_FIELD = 'kycReasonCodes';
const KYC_CUSTOMER_MESSAGE_FIELD = 'kycCustomerMessage';

/**
 * The applicant attributes an identity provider registers a person by. Exactly the set
 * `sumsub-applicant.ts` reads — middle names are collected for the record but not submitted,
 * because the provider compares against the document's own name fields.
 */
const KYC_APPLICANT_ROLES: readonly CanonicalFieldRole[] = [
  'firstName',
  'lastName',
  'dateOfBirth',
  'nationality',
  'country',
  'street',
  'town',
  'postCode',
];

/**
 * The slot: an identity check is served by a `kyc` adapter and nothing else. The author may add
 * payload keys and adapter config beside what the node derives — a provider option the node does
 * not know about, an extra attribute the level accepts — but may not override a derived one.
 */
const KYC_CONNECTOR_SLOT: NodeConnectorSlot = { types: ['kyc'], extras: 'all' };

export const KYC_VERIFIED_PORT = 'verified';
export const KYC_REVIEW_PORT = 'review';
export const KYC_REFUSED_PORT = 'refused';

/** `retry.IDENTITY` — one port per document set the provider can reset. */
export const buildRetryPort = (target: KycRetryTarget): string => `retry.${target}`;

export type KycIdentityVerificationNodeConfig = {
  readonly connector: NodeConnectorBinding;
  readonly levelName: string;
  readonly sourceKey: string;
  readonly questionnaireDefinitionId: string;
  readonly maxAttemptsPerDocSet: number;
};

type ResolvedDocument = {
  readonly payloadField: string;
  readonly sourceField: string;
  readonly entry: Record<string, unknown>;
  readonly optional: boolean;
};

/**
 * Joins each captured document to the choice that offered it. A document nobody offered is
 * compulsory and takes its issuing country from the applicant's residence — which is what a selfie
 * does, since no state issues one.
 */
const resolveDocuments = (
  contract: WorkflowNodeContract,
  countryField: string,
): readonly ResolvedDocument[] =>
  contract.documents.map((document) => {
    const option = contract.documentOptions.find(
      (candidate) => candidate.docType === document.docType,
    );
    const optional = option?.optional ?? false;
    const payloadField = toDocumentPayloadKey(document.field);

    return {
      payloadField,
      sourceField: document.field,
      optional,
      entry: {
        payloadField,
        idDocSetType: document.docSetType,
        idDocType: document.docType,
        ...(document.side === undefined ? {} : { idDocSubType: document.side }),
        countryField: option?.issuingCountryField ?? countryField,
        ...(optional ? { optional: true } : {}),
      },
    };
  });

/**
 * Submitting the applicant to an identity provider and routing on what it concluded. This is the
 * node that justifies the whole layer: hand-written, it was 209 lines — a sixteen-entry field
 * mapping, a five-entry optional mapping, a four-document upload table and seven `when`-qualified
 * transition arms, every one of which had to agree with the capture steps and the questionnaire.
 *
 * None of that is config here. The mapping comes from the canonical roles its neighbours publish,
 * the document table from what the capture and choice nodes publish, and the questionnaire paths
 * from the questionnaire node's own sections. The author names the provider, the level and the
 * attempt cap, and wires seven ports.
 */
export const kycIdentityVerificationNodeTypeDefinition = {
  type: 'kyc-identity-verification',
  category: 'verify',
  connectorSlot: KYC_CONNECTOR_SLOT,
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: [
        'connector',
        'levelName',
        'sourceKey',
        'questionnaireDefinitionId',
        'maxAttemptsPerDocSet',
      ],
      properties: {
        connector: connectorBindingSchema(KYC_CONNECTOR_SLOT),
        levelName: { type: 'string', minLength: 1 },
        sourceKey: { type: 'string', minLength: 1 },
        questionnaireDefinitionId: { type: 'string', minLength: 1 },
        maxAttemptsPerDocSet: { type: 'integer', minimum: 1 },
      },
    };
  },
  parseConfig(config, fail): KycIdentityVerificationNodeConfig {
    const source = asConfigObject(config, fail);

    return {
      connector: readConnectorBinding(source.connector, KYC_CONNECTOR_SLOT, fail),
      levelName: readString(source.levelName, fail),
      sourceKey: readString(source.sourceKey, fail),
      questionnaireDefinitionId: readString(source.questionnaireDefinitionId, fail),
      maxAttemptsPerDocSet: readPositiveInteger(source.maxAttemptsPerDocSet, fail),
    };
  },
  listPorts(): readonly WorkflowNodePort[] {
    return [
      { name: KYC_VERIFIED_PORT },
      { name: KYC_REVIEW_PORT },
      ...KYC_RETRY_TARGETS.map((target) => ({ name: buildRetryPort(target) })),
      { name: KYC_REFUSED_PORT },
    ];
  },
  listSubStepKeys(): readonly (string | null)[] {
    return [null];
  },
  buildFields(): NodeFieldMap {
    return {
      [KYC_OUTCOME_FIELD]: {
        type: 'text',
        required: false,
        validation: { oneOf: [...KYC_OUTCOMES] },
      },
      [KYC_RETRY_STEP_FIELD]: {
        type: 'text',
        required: false,
        validation: { oneOf: [...KYC_RETRY_TARGETS] },
      },
      [KYC_REASON_CODES_FIELD]: { type: 'array', required: false, items: { type: 'text' } },
      // Uncapped on purpose: the reviewer's comment is operator-authored free text at the provider
      // with no length guarantee, and a cap here fails the parked step's validator and loses the verdict.
      [KYC_CUSTOMER_MESSAGE_FIELD]: { type: 'text', required: false },
    };
  },
  compile(
    context: WorkflowNodeCompilationContext<KycIdentityVerificationNodeConfig>,
  ): RawWorkflowStep[] {
    const { config, contract, fail } = context;
    const fieldMapping: Record<string, string> = {};
    const optionalFieldMapping: Record<string, string> = {};

    for (const role of KYC_APPLICANT_ROLES) {
      // Nothing in the document collects it, so the provider would register an incomplete
      // applicant. An authoring gap, caught at load rather than on someone's onboarding.
      fieldMapping[role] = contract.canonicalFields[role] ?? fail('INVALID_VALUE');
    }

    if (contract.questionnaireItems.length === 0 || contract.documents.length === 0) {
      fail('INVALID_VALUE');
    }

    for (const item of contract.questionnaireItems) {
      fieldMapping[item.field] = item.field;
    }

    for (const option of contract.documentOptions) {
      // A choice offering a document no capture node collects would send the provider an issuing
      // country with nothing issued — the applicant picks it and then has nowhere to upload it.
      if (!contract.documents.some((document) => document.docType === option.docType)) {
        fail('INVALID_VALUE');
      }

      const target = option.optional ? optionalFieldMapping : fieldMapping;
      target[option.issuingCountryField] = option.issuingCountryField;
    }

    const documents = resolveDocuments(contract, fieldMapping.country);

    for (const document of documents) {
      const target = document.optional ? optionalFieldMapping : fieldMapping;
      target[document.payloadField] = document.sourceField;
    }

    const transitions: RawWorkflowTransition[] = [
      {
        status: 'success',
        when: { field: KYC_OUTCOME_FIELD, equals: 'verified' },
        target: context.targets[KYC_VERIFIED_PORT],
      },
      {
        status: 'success',
        when: { field: KYC_OUTCOME_FIELD, equals: 'human_review' },
        target: context.targets[KYC_REVIEW_PORT],
      },
      ...KYC_RETRY_TARGETS.map((retryTarget): RawWorkflowTransition => ({
        status: 'success',
        when: {
          all: [
            { field: KYC_OUTCOME_FIELD, equals: 'retry' },
            { field: KYC_RETRY_STEP_FIELD, equals: retryTarget },
          ],
        },
        target: context.targets[buildRetryPort(retryTarget)],
      })),
      // Unconditional and last: anything the arms above did not claim is a refusal.
      buildSuccessTransition(context.targets[KYC_REFUSED_PORT]),
    ];

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
            optionalFieldMapping,
            config: mergeDerivedWithExtras(
              {
                levelName: config.levelName,
                sourceKey: config.sourceKey,
                questionnaireDefinitionId: config.questionnaireDefinitionId,
                documents: documents.map((document) => document.entry),
                questionnairePathMap: Object.fromEntries(
                  contract.questionnaireItems.map((item) => [item.field, item.path]),
                ),
                maxAttemptsPerDocSet: config.maxAttemptsPerDocSet,
              },
              config.connector.config,
              fail,
            ),
          },
        ],
        transitions,
      },
    ];
  },
} as const satisfies WorkflowNodeTypeDefinition<KycIdentityVerificationNodeConfig>;
