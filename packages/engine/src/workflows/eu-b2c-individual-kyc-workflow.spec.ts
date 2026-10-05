import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStepDataValidator, validateAndNormalizeWorkflow } from '@tsh/ddl-schema';
import type {
  NormalizedWorkflowConnectorDeclaration,
  NormalizedWorkflowDefinition,
  NormalizedWorkflowStep,
} from '@tsh/ddl-schema';
import { parseHttpConnectorConfig } from '../connectors/adapters/built-in/http-request/http-request-config';
import { parseKycConfig } from '../connectors/adapters/built-in/kyc/kyc-config';
import type { KycDocumentMapping } from '../connectors/adapters/built-in/kyc/kyc-config';
import { KYC_RETRY_TARGETS } from '../connectors/adapters/built-in/kyc/kyc-contract';
import type { KycCallbackSubmission } from '../connectors/adapters/built-in/kyc/kyc-contract';
import { toAlpha3 } from '../connectors/adapters/built-in/kyc/kyc-country';
import { parseSumsubConfig } from '../connectors/adapters/built-in/sumsub-kyc/sumsub-config';
import type { ConnectorRejectionReason } from '../connectors/ports/connector-execution.port';
import { Step } from './domain/step';
import { BUILT_IN_WORKFLOWS_DIR } from './workflow-roots';

const SUMSUB_CONNECTOR_ID = 'sumsub_kyc';
const VERIFF_CONNECTOR_ID = 'veriff_kyc';

/**
 * Every key a KYC connector can emit as a callback. The engine re-submits the callback through
 * the step that parked, and an undeclared key is an `UNKNOWN` field error that loses the verdict —
 * so the parked step must declare all of them, not just the two a happy path uses.
 */
const KYC_CALLBACK_FIELDS = [
  'kycOutcome',
  'kycRetryStep',
  'kycReasonCodes',
  'kycCustomerMessage',
] as const satisfies readonly (keyof KycCallbackSubmission)[];
const ATTEMPT_COUNT_FIELD = 'kycAttemptCount' as const;

/** Every callback body the kernel can produce for any provider, spelled out rather than sampled. */
const KYC_CALLBACK_BODIES: readonly KycCallbackSubmission[] = [
  { kycOutcome: 'verified' },
  { kycOutcome: 'human_review' },
  { kycOutcome: 'refused' },
  { kycOutcome: 'refused', kycReasonCodes: ['FRAUD'], kycCustomerMessage: 'Refused' },
  ...KYC_RETRY_TARGETS.map((docSet) => ({ kycOutcome: 'retry' as const, kycRetryStep: docSet })),
  {
    kycOutcome: 'retry',
    kycRetryStep: 'IDENTITY',
    kycReasonCodes: ['BLURRY_PHOTO'],
    kycCustomerMessage: 'Please retake the photo',
  },
];

type KycFamily = {
  /** The workflow family: its two revisions share this id. */
  readonly id: string;
  readonly connectorId: string;
  readonly parseConfig: (config: Readonly<Record<string, unknown>>) => {
    readonly documents: readonly KycDocumentMapping[];
  };
  /** The callback keys the parked step declares, by revision. */
  readonly callbackFields: Readonly<Record<number, readonly string[]>>;
  readonly callbackBodies: readonly KycCallbackSubmission[];
};

const FOUR_CALLBACK_FIELDS: readonly string[] = KYC_CALLBACK_FIELDS;
const FIVE_CALLBACK_FIELDS: readonly string[] = [...KYC_CALLBACK_FIELDS, ATTEMPT_COUNT_FIELD];

/**
 * The two providers the combined route ships for. Sumsub's revision 1 was written by hand before
 * `kycAttemptCount` existed and is immutable once stored, so it declares four callback fields;
 * every other revision declares five.
 */
const KYC_FAMILIES: readonly KycFamily[] = [
  {
    id: 'eu-b2c-individual-kyc-eea',
    connectorId: SUMSUB_CONNECTOR_ID,
    parseConfig: parseSumsubConfig,
    callbackFields: { 1: FOUR_CALLBACK_FIELDS, 2: FIVE_CALLBACK_FIELDS },
    callbackBodies: KYC_CALLBACK_BODIES,
  },
  {
    id: 'eu-b2c-individual-kyc-eea-veriff',
    connectorId: VERIFF_CONNECTOR_ID,
    parseConfig: (config) => parseKycConfig(VERIFF_CONNECTOR_ID, config),
    callbackFields: { 1: FIVE_CALLBACK_FIELDS, 2: FIVE_CALLBACK_FIELDS },
    callbackBodies: [
      ...KYC_CALLBACK_BODIES,
      { kycOutcome: 'retry', kycRetryStep: 'IDENTITY', kycAttemptCount: 1 },
    ],
  },
];

/**
 * Every workflow field a reset docSet asks the customer to correct. Derived from the declaration
 * rather than hard-coded, so a document that names its capture fields differently is still held to
 * the rule, and a docSet spanning several uploads (an ID card's two sides) yields all of them. The
 * questionnaire path map is read from the raw config, since only Sumsub's parser requires it.
 */
const fieldsOwnedByDocSet = (
  family: KycFamily,
  connector: NormalizedWorkflowConnectorDeclaration,
): Readonly<Record<string, readonly string[]>> => {
  const config = family.parseConfig(connector.config);
  const questionnairePathMap = connector.config.questionnairePathMap as Record<string, string>;
  const mapping = { ...connector.fieldMapping, ...connector.optionalFieldMapping };
  const fieldsFor = (docSetType: string): string[] =>
    config.documents
      .filter((document) => document.idDocSetType === docSetType)
      .map((document) => mapping[document.payloadField]);

  return {
    IDENTITY: fieldsFor('IDENTITY'),
    SELFIE: fieldsFor('SELFIE'),
    QUESTIONNAIRE: [mapping[Object.keys(questionnairePathMap)[0]]],
  };
};

/** Step names reachable from `start` by following declared transitions. */
const reachableFrom = (definition: NormalizedWorkflowDefinition, start: string): Set<string> => {
  const seen = new Set<string>([start]);
  const queue = [start];

  while (queue.length > 0) {
    for (const transition of definition.stepsByName[queue.shift()!].transitions) {
      const target = transition.target;
      if (target !== undefined && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }

  return seen;
};

const definitions: [string, NormalizedWorkflowDefinition][] = readdirSync(BUILT_IN_WORKFLOWS_DIR)
  .filter((fileName) => fileName.endsWith('.json'))
  .sort()
  .map((fileName) => [
    fileName,
    validateAndNormalizeWorkflow(
      JSON.parse(readFileSync(resolve(BUILT_IN_WORKFLOWS_DIR, fileName), 'utf8')),
    ),
  ]);

const parkedStep = (definition: NormalizedWorkflowDefinition): NormalizedWorkflowStep[] =>
  definition.steps.filter((step) => step.connectors.some((connector) => connector.async));

describe('built-in workflows', () => {
  it('ships exactly the combined route per provider, as two revisions of one workflow each', () => {
    // Revision 1 is written step by step as `custom` steps, revision 2 the same flow as a
    // graph of specialized steps. Both ship for each provider, so every invariant below runs
    // against all four.
    expect(definitions.map(([fileName]) => fileName)).toEqual([
      'eu-b2c-individual-kyc-eea-v2.workflow.json',
      'eu-b2c-individual-kyc-eea-veriff-v2.workflow.json',
      'eu-b2c-individual-kyc-eea-veriff.workflow.json',
      'eu-b2c-individual-kyc-eea.workflow.json',
    ]);
    for (const family of KYC_FAMILIES) {
      expect(
        definitions
          .filter(([, definition]) => definition.id === family.id)
          .map(([, definition]) => definition.version)
          .sort(),
      ).toEqual([1, 2]);
    }
    expect(new Set(definitions.map(([, definition]) => definition.id)).size).toBe(
      KYC_FAMILIES.length,
    );
  });

  it('claims no sourceKey another built-in workflow already claims', () => {
    const workflowIdBySourceKey = new Map<string, string>();

    for (const [, definition] of definitions) {
      for (const step of definition.steps) {
        for (const connector of step.connectors) {
          const sourceKey = connector.config.sourceKey;
          if (typeof sourceKey !== 'string') {
            continue;
          }

          expect(workflowIdBySourceKey.get(sourceKey) ?? definition.id).toBe(definition.id);
          workflowIdBySourceKey.set(sourceKey, definition.id);
        }
      }
    }
  });

  describe.each(KYC_FAMILIES.map((family) => [family.id, family] as const))(
    'the %s family',
    (_id, family) => {
      const revisions = definitions.filter(([, definition]) => definition.id === family.id);

      /** Every field a document mapping names as its issuing country, wherever the step declares it. */
      const issuingCountryFields = (
        definition: NormalizedWorkflowDefinition,
      ): { field: string; oneOf: readonly string[] }[] => {
        const connector = definition.stepsByName.submit_kyc.connectors.find(
          (candidate) => candidate.id === family.connectorId,
        )!;
        const mapping = { ...connector.fieldMapping, ...connector.optionalFieldMapping };

        return [
          ...new Set(
            family
              .parseConfig(connector.config)
              .documents.map((document) => document.countryField)
              .filter((field): field is string => field !== undefined)
              .map((payloadKey) => mapping[payloadKey]),
          ),
        ].map((field) => {
          const owner = definition.steps.find((step) => field in step.data)!;
          const declared = owner.data[field] as { validation?: { oneOf?: readonly string[] } };
          return { field, oneOf: declared.validation?.oneOf ?? [] };
        });
      };

      it('never offers an issuing country the ISO table cannot map', () => {
        for (const [, definition] of revisions) {
          const fields = issuingCountryFields(definition);

          expect(fields.length).toBeGreaterThan(0);
          for (const { field, oneOf } of fields) {
            expect(oneOf.length).toBeGreaterThan(0);
            for (const alpha2 of oneOf) {
              expect(() => toAlpha3(alpha2, field)).not.toThrow();
            }
          }
        }
      });

      it('offers no nationality that no route can supply a document for', () => {
        for (const [, definition] of revisions) {
          const servable = new Set(issuingCountryFields(definition).flatMap(({ oneOf }) => oneOf));
          const nationality = definition.stepsByName.collect_personal.data.nationality as {
            validation?: { oneOf?: readonly string[] };
          };

          // An identity document is issued to nationals of the issuing state, so a nationality no route
          // can serve would strand that applicant with nothing to present.
          for (const alpha2 of nationality.validation?.oneOf ?? []) {
            expect([...servable]).toContain(alpha2);
          }
        }
      });

      it('caps no callback field the provider controls the length of', () => {
        for (const [, definition] of revisions) {
          const message = definition.stepsByName.submit_kyc.data.kycCustomerMessage as {
            validation?: { maxLength?: number };
          };

          // `moderationComment` is operator-authored free text at Sumsub with no length guarantee; a
          // cap here fails the parked step's own validator and loses the verdict.
          expect(message.validation?.maxLength).toBeUndefined();
        }
      });

      describe.each(revisions)('the combined route (%s)', (_fileName, definition) => {
        const connector = definition.stepsByName.submit_kyc.connectors[0];

        const walk = (documentType: 'PASSPORT' | 'ID_CARD') => {
          const context: Record<string, unknown> = {
            documentType,
            ...Object.fromEntries(
              Object.keys(definition.stepsByName.collect_personal.data)
                .concat(Object.keys(definition.stepsByName.collect_purpose.data))
                .map((field) => [field, 'seeded']),
            ),
          };
          const country =
            documentType === 'PASSPORT' ? 'passportIssuingCountry' : 'idCardIssuingCountry';
          context[country] = 'FR';

          // Follow the graph from the choice, exactly as the engine routes it.
          const visited: string[] = [];
          let current = new Step(definition.stepsByName.select_document_type).resolveTransition(
            'success',
            context,
          )!.target!;

          while (current !== 'submit_kyc') {
            const step = new Step(definition.stepsByName[current]);
            visited.push(current);

            const [field] = Object.keys(definition.stepsByName[current].data);
            const accepted = step.collectAcceptedData({ [field]: `${field}-id` }, context);

            expect(accepted.acceptedData).not.toBeNull();
            Object.assign(context, accepted.acceptedData);
            current = step.resolveTransition('success', context)!.target!;
          }

          return { context, visited };
        };

        it('routes the document choice on the choice itself, with no catch-all arm', () => {
          const step = new Step(definition.stepsByName.select_document_type);

          expect(step.resolveTransition('success', { documentType: 'PASSPORT' })?.target).toBe(
            'capture_passport',
          );
          expect(step.resolveTransition('success', { documentType: 'ID_CARD' })?.target).toBe(
            'capture_id_card_front',
          );
          // Both arms name their condition, so nothing silently absorbs a value the enum never allows.
          // A submit reaching neither resolves to no transition, which the engine ends as `invalid`.
          expect(
            step.resolveTransition('success', { documentType: 'DRIVERS_LICENCE' }),
          ).toBeUndefined();
          expect(
            definition.stepsByName.select_document_type.transitions.every(
              (transition) => transition.when !== undefined,
            ),
          ).toBe(true);
        });

        it.each([
          ['PASSPORT', ['capture_passport', 'capture_selfie'], ['idCardFront', 'idCardBack']],
          [
            'ID_CARD',
            ['capture_id_card_front', 'capture_id_card_back', 'capture_selfie'],
            ['passportDocument'],
          ],
        ] as const)(
          'walks a %s applicant past the other document entirely',
          (type, path, unasked) => {
            const { context, visited } = walk(type);

            expect(visited).toEqual(path);
            for (const field of unasked) {
              expect(Object.keys(context)).not.toContain(field);
            }
          },
        );

        it.each([
          ['PASSPORT', ['passportDocumentId', 'selfieDocumentId']],
          ['ID_CARD', ['idCardFrontId', 'idCardBackId', 'selfieDocumentId']],
        ] as const)('uploads exactly the documents a %s applicant supplied', (type, expected) => {
          const { context } = walk(type);
          const payload: Record<string, unknown> = {};

          for (const [payloadKey, source] of Object.entries(connector.fieldMapping)) {
            // A required mapping that cannot resolve is a 500 in buildPayload, not a field error.
            expect(Object.keys(context)).toContain(source);
            payload[payloadKey] = context[source];
          }
          for (const [payloadKey, source] of Object.entries(connector.optionalFieldMapping)) {
            if (source in context) {
              payload[payloadKey] = context[source];
            }
          }

          const documents = family.parseConfig(connector.config).documents;
          const supplied = documents
            .filter((document) => payload[document.payloadField] !== undefined)
            .map((document) => document.payloadField);

          expect(supplied).toEqual(expected);
          // Every document actually uploaded must be able to name its issuing country.
          for (const document of documents.filter(
            (candidate) => payload[candidate.payloadField] !== undefined,
          )) {
            expect(payload[document.countryField as string]).toBeDefined();
          }
        });

        it('marks every document that only one branch supplies as optional', () => {
          const documents = family.parseConfig(connector.config).documents;
          const optionalSources = Object.values(connector.optionalFieldMapping);

          for (const document of documents) {
            const source = {
              ...connector.fieldMapping,
              ...connector.optionalFieldMapping,
            }[document.payloadField];

            expect(document.optional === true).toBe(optionalSources.includes(source));
          }
        });
      });

      describe.each(revisions)('%s', (_fileName, definition) => {
        it('parks on exactly one async step, the only one a KYC callback can resolve', () => {
          // A field name is unique across a document, so two parked steps could not both declare the
          // callback's key set — the second would fail to load with DUPLICATE_FIELD_NAME.
          expect(parkedStep(definition)).toHaveLength(1);
        });

        it('declares every field the KYC callback can submit', () => {
          const [step] = parkedStep(definition);

          expect(Object.keys(step.data)).toEqual(
            expect.arrayContaining([...family.callbackFields[definition.version]]),
          );
          expect(Object.keys(step.data).filter((key) => key.startsWith('kyc'))).toHaveLength(
            family.callbackFields[definition.version].length,
          );
        });

        it.each(family.callbackBodies.map((body) => [JSON.stringify(body), body]))(
          'accepts the callback body %s',
          (_label, body) => {
            const [step] = parkedStep(definition);
            const validate = createStepDataValidator(step, [
              ...family.callbackFields[definition.version],
            ]);

            expect(validate(body)).toBe(true);
          },
        );

        it('routes every retry back to a step that owns the data the docSet reset', () => {
          const [step] = parkedStep(definition);
          const retryBranch = (transition: {
            when?: unknown;
          }): { equals?: unknown }[] | undefined =>
            (transition.when as { all?: { equals?: unknown }[] } | undefined)?.all;
          const retryTargets = step.transitions.filter(
            (transition) => retryBranch(transition)?.[0]?.equals === 'retry',
          );

          expect(retryTargets).toHaveLength(KYC_RETRY_TARGETS.length);

          const ownedBy = fieldsOwnedByDocSet(
            family,
            step.connectors.find((connector) => connector.id === family.connectorId)!,
          );

          for (const transition of retryTargets) {
            const docSet = String(retryBranch(transition)?.[1]?.equals);
            const targetName = transition.target as string;

            expect(definition.stepsByName[targetName]).toBeDefined();

            if (docSet === 'APPLICANT_DATA') {
              // `createApplicant` returns the existing applicant on a repeat `externalUserId` and the
              // adapter has no way to update `fixedInfo`, so re-collecting personal data could never
              // reach Sumsub. A human resolves it instead of the customer retyping into a void.
              expect(definition.stepsByName[targetName].status).toBe('awaiting_manual_review');
              continue;
            }

            // Every field the docSet reset must be re-collectable from where the retry lands, or the
            // loop cannot converge.
            const reachable = reachableFrom(definition, targetName);
            for (const field of ownedBy[docSet]) {
              expect(
                [...reachable].some((name) => field in definition.stepsByName[name].data),
              ).toBe(true);
            }
          }
        });

        it('parses every connector config the adapters validate at load time', () => {
          for (const step of definition.steps) {
            for (const connector of step.connectors) {
              if (connector.id === family.connectorId) {
                expect(() => family.parseConfig(connector.config)).not.toThrow();
              }

              if (connector.id === 'http_request') {
                expect(() =>
                  parseHttpConnectorConfig(
                    {
                      context: `${definition.id}/${step.name}`,
                      config: connector.config,
                      fieldMapping: connector.fieldMapping,
                    },
                    {},
                  ),
                ).not.toThrow();
              }
            }
          }
        });

        it('maps only fields that are required and persisted, so no verdict callback can 500', () => {
          // The callback re-reads the whole fieldMapping from persisted context and throws on a miss.
          for (const step of definition.steps) {
            for (const connector of step.connectors) {
              for (const sourceField of Object.values(connector.fieldMapping)) {
                const owner = definition.steps.find((candidate) => sourceField in candidate.data);

                expect(owner).toBeDefined();
                const field = owner!.data[sourceField];
                expect(field.when).toBeUndefined();

                if (connector.id === family.connectorId) {
                  expect(field.required).toBe(true);
                  expect(field.persist).toBe(true);
                }
              }
            }
          }
        });

        it('sends a fresh code for a stale challenge and still refuses everything else', () => {
          const step = new Step(definition.stepsByName.verify_phone_code);
          const resendable: ConnectorRejectionReason[] = [
            'CHALLENGE_EXPIRED',
            'CHALLENGE_NOT_FOUND',
          ];
          const refusals: ConnectorRejectionReason[] = ['ATTEMPTS_EXHAUSTED', 'CONNECTOR_REJECTED'];

          for (const reason of resendable) {
            const target = step.resolveTransition('rejected', {}, reason)?.target;

            expect(target).toBe('resend_phone_code');
            // The resend step must be able to issue a new code and hand the customer back.
            const resend = definition.stepsByName[target as string];
            expect(resend.connectors[0].config.operation).toBe('startVerification');
            expect(resend.transitions[0].target).toBe('verify_phone_code');
          }

          for (const reason of refusals) {
            const target = step.resolveTransition('rejected', {}, reason)?.target;

            expect(definition.stepsByName[target as string].status).toBe('rejected');
          }
        });

        it('lets a stray submit on the manual review step resolve without destroying the onboarding', () => {
          const step = definition.steps.find(
            (candidate) => candidate.status === 'awaiting_manual_review',
          );

          expect(step).toBeDefined();
          expect(step!.transitions.some((transition) => transition.status === 'success')).toBe(
            true,
          );
        });
      });
    },
  );
});
