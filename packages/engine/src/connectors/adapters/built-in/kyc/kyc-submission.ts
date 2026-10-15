import type { ObjectStoragePort } from '../../../../storage/object-storage.port';
import type { ConnectorExecutionInput } from '../../../ports/connector-adapter.port';
import type { CompletedOnboardingDocumentResolver } from '../../../resolvers/completed-onboarding-document.resolver';
import type { KycConfig, KycDocumentMapping } from './kyc-config';
import { readCompletedDocument } from '../shared/read-completed-document';
import { normalizeAlpha2 } from './kyc-country';
import type { KycApplicant, KycDocument, KycSubmission } from './kyc-provider.port';

/**
 * A KYC connector payload missing a required identity field — an authoring defect in the
 * workflow's step data, not a provider error.
 */
export class KycApplicantPayloadInvalidError extends Error {
  constructor(connectorId: string, key: string) {
    super(`Missing required ${connectorId} applicant field "${key}"`);
    this.name = 'KycApplicantPayloadInvalidError';
  }
}

type KycPayload = Readonly<Record<string, unknown>>;

function readRequiredString(connectorId: string, payload: KycPayload, key: string): string {
  const value = payload[key];

  if (typeof value !== 'string' || value.trim() === '') {
    throw new KycApplicantPayloadInvalidError(connectorId, key);
  }

  return value.trim();
}

function readOptionalString(payload: KycPayload, key: string): string | undefined {
  const value = payload[key];

  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Builds the applicant from the eight canonical roles in a connector payload. `nationality` and
 * `country` are validated against the ISO table and kept as alpha-2; an unassigned code throws
 * here rather than reaching a provider that would accept and mis-register it.
 */
export function buildKycApplicant(connectorId: string, payload: KycPayload): KycApplicant {
  return {
    firstName: readRequiredString(connectorId, payload, 'firstName'),
    lastName: readRequiredString(connectorId, payload, 'lastName'),
    dateOfBirth: readRequiredString(connectorId, payload, 'dateOfBirth'),
    nationality: normalizeAlpha2(
      readRequiredString(connectorId, payload, 'nationality'),
      'nationality',
    ),
    country: normalizeAlpha2(readRequiredString(connectorId, payload, 'country'), 'country'),
    street: readOptionalString(payload, 'street'),
    town: readOptionalString(payload, 'town'),
    postCode: readOptionalString(payload, 'postCode'),
  };
}

/** An optional entry the applicant supplied nothing for: the document type they did not choose. */
function isSkippableDocument(document: KycDocumentMapping, payload: KycPayload): boolean {
  return document.optional === true && payload[document.payloadField] === undefined;
}

/**
 * The document's issuing country, either fixed in config or read from the applicant's own answer
 * — which is what lets one declaration serve every jurisdiction instead of one per country.
 * `parseKycConfig` has already guaranteed exactly one of the two is set.
 */
function resolveDocumentCountry(
  connectorId: string,
  document: KycDocumentMapping,
  payload: KycPayload,
): string {
  if (document.country !== undefined) {
    return document.country;
  }

  const field = document.countryField as string;

  return normalizeAlpha2(readRequiredString(connectorId, payload, field), field);
}

/**
 * Every configured questionnaire item key is read from the connector payload. A value that is
 * neither a string nor a boolean is treated as absent — the same as a key missing entirely —
 * which is how a conditional item whose condition did not hold is recognised downstream.
 */
function resolveQuestionnaireAnswers(
  pathMap: Readonly<Record<string, string>>,
  payload: KycPayload,
): Readonly<Record<string, string | boolean | undefined>> {
  const answers: Record<string, string | boolean | undefined> = {};

  for (const itemKey of Object.keys(pathMap)) {
    const value = payload[itemKey];
    answers[itemKey] = typeof value === 'string' || typeof value === 'boolean' ? value : undefined;
  }

  return answers;
}

/**
 * Assembles everything a provider needs from the step's payload, before any provider call: the
 * applicant, every captured document resolved and read from object storage, and the questionnaire
 * answers. `undefined` means the step cannot be submitted as it stands — no document was supplied
 * or one failed to resolve — and the connector answers `invalid()`. A malformed country or
 * identity field throws instead, because it is an authoring defect rather than missing input.
 */
export async function buildKycSubmission(
  connectorId: string,
  config: KycConfig,
  input: ConnectorExecutionInput,
  documentResolver: CompletedOnboardingDocumentResolver,
  objectStoragePort: ObjectStoragePort,
): Promise<KycSubmission | undefined> {
  // Resolved up front: every payload check runs before the first side effect, so a country that
  // cannot be mapped must not leave an orphan applicant behind at the provider.
  const requested = config.documents
    .filter((document) => !isSkippableDocument(document, input.payload))
    .map((document) => ({
      document,
      country: resolveDocumentCountry(connectorId, document, input.payload),
    }));

  if (requested.length === 0) {
    return undefined;
  }

  const applicant = buildKycApplicant(connectorId, input.payload);
  const documents: KycDocument[] = [];

  for (const { document, country } of requested) {
    const documentId = input.payload[document.payloadField];

    if (typeof documentId !== 'string' || documentId.trim().length === 0) {
      return undefined;
    }

    const source = input.payloadFieldSources[document.payloadField];
    const sourceField = typeof source === 'string' ? source : document.payloadField;
    const read = await readCompletedDocument(documentResolver, objectStoragePort, {
      documentId,
      onboardingId: input.execution.onboardingId,
      sourceField,
    });

    if (!read) {
      return undefined;
    }

    const { resolved, content } = read;

    documents.push({
      documentId,
      sourceField,
      docSet: document.idDocSetType,
      docType: document.idDocType,
      side: document.idDocSubType,
      country,
      contentType: resolved.contentType,
      content,
    });
  }

  return {
    onboardingId: input.execution.onboardingId,
    sourceKey: config.sourceKey,
    providerConfig: config.providerConfig,
    applicant,
    documents,
    questionnaire: config.questionnairePathMap
      ? {
          pathMap: config.questionnairePathMap,
          answers: resolveQuestionnaireAnswers(config.questionnairePathMap, input.payload),
        }
      : undefined,
  };
}
