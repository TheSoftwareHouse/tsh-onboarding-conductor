import type { ConnectorSettingsSchema } from '../../../ports/connector-adapter.port';

/**
 * All three are operator-provided connector settings configured through the admin API
 * (`PUT /v1/admin/connectors/sumsub_kyc`), not environment variables — the `connectors` table is
 * the only source, and all are editable at runtime.
 *
 * `appToken` and `secretKey` sign the calls the adapter makes to Sumsub;
 * `callbackSigningSecret` is the one Sumsub signs its callbacks to us with, and
 * `CallbackSignatureVerifier` reads it from here rather than from the environment
 * (`docs/decisions/0006-callback-signing-secret-in-connector-settings.md`). A rotation window is a
 * comma-separated list of secrets, every one of which the verifier accepts; a secret containing a
 * comma therefore cannot be stored.
 */
export const SUMSUB_KYC_SETTINGS_SCHEMA: ConnectorSettingsSchema = {
  fields: [
    { key: 'appToken', secret: false, required: true },
    { key: 'secretKey', secret: true, required: true },
    { key: 'callbackSigningSecret', secret: true, required: true },
  ],
};

/**
 * One document upload the adapter submits to Sumsub. `idDocType`, `idDocSubType` and `country`
 * become the JSON metadata part of the multipart upload. Two entries sharing one `idDocSetType`
 * is normal and expected — the front and back of one ID card are two uploads into one slot.
 */
export type SumsubDocumentMapping = {
  /** Our connector payload key holding the documentId. */
  readonly payloadField: string;
  /** The Sumsub slot: IDENTITY, SELFIE, ... */
  readonly idDocSetType: string;
  /** ID_CARD, PASSPORT, SELFIE, ... */
  readonly idDocType: string;
  /** FRONT_SIDE / BACK_SIDE; absent for SELFIE. */
  readonly idDocSubType?: string;
  /** ISO alpha-3, fixed for the whole revision. Mutually exclusive with `countryField`. */
  readonly country?: string;
  /**
   * Connector payload key holding the applicant's own issuing country as ISO alpha-2, for a
   * workflow that serves more than one jurisdiction from a single declaration.
   */
  readonly countryField?: string;
  /**
   * Whether this upload may be absent. A workflow offering a choice of document declares one entry
   * per document type and marks them all optional, so the applicant supplies only the set their
   * own document has and the rest are skipped rather than failing the step.
   */
  readonly optional?: boolean;
};

/**
 * The workflow declaration's `config`, parsed. `sourceKey` and `documents` are both required and
 * authoritative — Sumsub's level is read only as a drift alarm against them, never a substitute.
 * `maxAttemptsPerDocSet` carries no code default: an operator who omits it gets a parse failure
 * naming the key rather than a silently-assumed cap.
 */
export type SumsubConfig = {
  readonly levelName: string;
  readonly sourceKey: string;
  readonly questionnaireDefinitionId: string;
  readonly documents: readonly SumsubDocumentMapping[];
  readonly questionnairePathMap: Readonly<Record<string, string>>;
  readonly maxAttemptsPerDocSet: number;
};

/**
 * A malformed `sumsub_kyc` connector declaration `config` — a startup-time authoring defect, not
 * a client-facing error, per `packages/engine/CLAUDE.md`'s two-tier error contract.
 */
export class SumsubConfigInvalidError extends Error {
  constructor(key: string, reason: string) {
    super(`Invalid sumsub_kyc connector config key "${key}": ${reason}`);
    this.name = 'SumsubConfigInvalidError';
  }
}

const ISO_ALPHA_3_PATTERN = /^[A-Z]{3}$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseNonEmptyString = (value: unknown, key: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SumsubConfigInvalidError(key, 'must be a non-empty string');
  }

  return value.trim();
};

const parseDocumentMapping = (value: unknown, index: number): SumsubDocumentMapping => {
  const key = `documents[${index}]`;

  if (!isPlainObject(value)) {
    throw new SumsubConfigInvalidError(key, 'must be an object');
  }

  const payloadField = parseNonEmptyString(value.payloadField, `${key}.payloadField`);
  const idDocSetType = parseNonEmptyString(value.idDocSetType, `${key}.idDocSetType`);
  const idDocType = parseNonEmptyString(value.idDocType, `${key}.idDocType`);

  // Exactly one source for the issuing country: fixed here, or collected from the applicant.
  const hasCountry = value.country !== undefined;
  const hasCountryField = value.countryField !== undefined;

  if (hasCountry === hasCountryField) {
    throw new SumsubConfigInvalidError(
      `${key}.country`,
      'exactly one of country and countryField must be set',
    );
  }

  let country: string | undefined;
  let countryField: string | undefined;

  if (hasCountry) {
    country = parseNonEmptyString(value.country, `${key}.country`);

    if (!ISO_ALPHA_3_PATTERN.test(country)) {
      throw new SumsubConfigInvalidError(`${key}.country`, 'must be an ISO alpha-3 code');
    }
  } else {
    countryField = parseNonEmptyString(value.countryField, `${key}.countryField`);
  }

  const idDocSubType =
    value.idDocSubType === undefined
      ? undefined
      : parseNonEmptyString(value.idDocSubType, `${key}.idDocSubType`);

  if (value.optional !== undefined && typeof value.optional !== 'boolean') {
    throw new SumsubConfigInvalidError(`${key}.optional`, 'must be a boolean');
  }

  const optional = value.optional === true;

  return { payloadField, idDocSetType, idDocType, idDocSubType, country, countryField, optional };
};

const parseDocuments = (value: unknown): readonly SumsubDocumentMapping[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SumsubConfigInvalidError('documents', 'must be a non-empty array');
  }

  return value.map((entry, index) => parseDocumentMapping(entry, index));
};

const parseQuestionnairePathMap = (value: unknown): Readonly<Record<string, string>> => {
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    throw new SumsubConfigInvalidError('questionnairePathMap', 'must be a non-empty object');
  }

  const entries: Record<string, string> = {};

  for (const [itemKey, itemValue] of Object.entries(value)) {
    const path = parseNonEmptyString(itemValue, `questionnairePathMap.${itemKey}`);

    if (!path.includes('.')) {
      throw new SumsubConfigInvalidError(
        `questionnairePathMap.${itemKey}`,
        'must be a "<section>.<item>" path',
      );
    }

    entries[itemKey] = path;
  }

  return entries;
};

const parseMaxAttemptsPerDocSet = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new SumsubConfigInvalidError('maxAttemptsPerDocSet', 'must be a positive integer');
  }

  return value;
};

/**
 * Parses a `sumsub_kyc` workflow declaration's `config` into its typed shape. Throws
 * `SumsubConfigInvalidError` naming the offending key on any malformed or missing value.
 */
export function parseSumsubConfig(config: Readonly<Record<string, unknown>>): SumsubConfig {
  return {
    levelName: parseNonEmptyString(config.levelName, 'levelName'),
    sourceKey: parseNonEmptyString(config.sourceKey, 'sourceKey'),
    questionnaireDefinitionId: parseNonEmptyString(
      config.questionnaireDefinitionId,
      'questionnaireDefinitionId',
    ),
    documents: parseDocuments(config.documents),
    questionnairePathMap: parseQuestionnairePathMap(config.questionnairePathMap),
    maxAttemptsPerDocSet: parseMaxAttemptsPerDocSet(config.maxAttemptsPerDocSet),
  };
}
