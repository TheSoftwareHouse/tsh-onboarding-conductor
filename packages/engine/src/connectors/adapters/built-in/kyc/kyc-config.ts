import { KycCountryInvalidError, normalizeAlpha2, toAlpha2 } from './kyc-country';

/**
 * One document the connector submits to the provider. Two entries sharing one `idDocSetType` is
 * normal — the front and back of one ID card are two uploads into one slot.
 */
export type KycDocumentMapping = {
  /** Our connector payload key holding the documentId. */
  readonly payloadField: string;
  /** The provider's slot: IDENTITY, SELFIE, ... */
  readonly idDocSetType: string;
  /** ID_CARD, PASSPORT, SELFIE, ... */
  readonly idDocType: string;
  /** FRONT_SIDE / BACK_SIDE; absent for SELFIE. */
  readonly idDocSubType?: string;
  /** ISO alpha-2, fixed for the whole revision. Mutually exclusive with `countryField`. */
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
 * The workflow declaration's `config`, parsed. `providerConfig` is every key no kernel rule
 * consumed, so a provider's own keys reach it wherever they were authored. `maxAttemptsPerDocSet`
 * carries no code default: an operator who omits it gets a parse failure naming the key.
 */
export type KycConfig = {
  readonly sourceKey: string;
  readonly documents: readonly KycDocumentMapping[];
  readonly questionnairePathMap?: Readonly<Record<string, string>>;
  readonly maxAttemptsPerDocSet: number;
  readonly providerConfig: Readonly<Record<string, unknown>>;
};

/**
 * A malformed KYC connector declaration `config` — a startup-time authoring defect, not a
 * client-facing error, per `packages/engine/CLAUDE.md`'s two-tier error contract.
 */
export class KycConfigInvalidError extends Error {
  constructor(connectorId: string, key: string, reason: string) {
    super(`Invalid ${connectorId} connector config key "${key}": ${reason}`);
    this.name = 'KycConfigInvalidError';
  }
}

const KERNEL_CONFIG_KEYS = [
  'sourceKey',
  'documents',
  'questionnairePathMap',
  'maxAttemptsPerDocSet',
] as const;

const ISO_COUNTRY_PATTERN = /^[A-Z]{2,3}$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseNonEmptyString = (connectorId: string, value: unknown, key: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new KycConfigInvalidError(connectorId, key, 'must be a non-empty string');
  }

  return value.trim();
};

/** A fixed country is accepted as alpha-2 or alpha-3 and stored as alpha-2. */
const parseFixedCountry = (connectorId: string, value: unknown, key: string): string => {
  const code = parseNonEmptyString(connectorId, value, key).toUpperCase();

  if (!ISO_COUNTRY_PATTERN.test(code)) {
    throw new KycConfigInvalidError(connectorId, key, 'must be an ISO alpha-2 or alpha-3 code');
  }

  try {
    return code.length === 2 ? normalizeAlpha2(code, key) : toAlpha2(code, key);
  } catch (error) {
    if (error instanceof KycCountryInvalidError) {
      throw new KycConfigInvalidError(connectorId, key, 'must be an assigned ISO country code');
    }

    throw error;
  }
};

const parseDocumentMapping = (
  connectorId: string,
  value: unknown,
  index: number,
): KycDocumentMapping => {
  const key = `documents[${index}]`;

  if (!isPlainObject(value)) {
    throw new KycConfigInvalidError(connectorId, key, 'must be an object');
  }

  const payloadField = parseNonEmptyString(connectorId, value.payloadField, `${key}.payloadField`);
  const idDocSetType = parseNonEmptyString(connectorId, value.idDocSetType, `${key}.idDocSetType`);
  const idDocType = parseNonEmptyString(connectorId, value.idDocType, `${key}.idDocType`);

  // Exactly one source for the issuing country: fixed here, or collected from the applicant.
  const hasCountry = value.country !== undefined;
  const hasCountryField = value.countryField !== undefined;

  if (hasCountry === hasCountryField) {
    throw new KycConfigInvalidError(
      connectorId,
      `${key}.country`,
      'exactly one of country and countryField must be set',
    );
  }

  const country = hasCountry
    ? parseFixedCountry(connectorId, value.country, `${key}.country`)
    : undefined;
  const countryField = hasCountryField
    ? parseNonEmptyString(connectorId, value.countryField, `${key}.countryField`)
    : undefined;

  const idDocSubType =
    value.idDocSubType === undefined
      ? undefined
      : parseNonEmptyString(connectorId, value.idDocSubType, `${key}.idDocSubType`);

  if (value.optional !== undefined && typeof value.optional !== 'boolean') {
    throw new KycConfigInvalidError(connectorId, `${key}.optional`, 'must be a boolean');
  }

  const optional = value.optional === true;

  return { payloadField, idDocSetType, idDocType, idDocSubType, country, countryField, optional };
};

const parseDocuments = (connectorId: string, value: unknown): readonly KycDocumentMapping[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new KycConfigInvalidError(connectorId, 'documents', 'must be a non-empty array');
  }

  return value.map((entry, index) => parseDocumentMapping(connectorId, entry, index));
};

/** Absent or empty means "no questionnaire"; a provider that needs one says so in its own check. */
const parseQuestionnairePathMap = (
  connectorId: string,
  value: unknown,
): Readonly<Record<string, string>> | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!isPlainObject(value)) {
    throw new KycConfigInvalidError(connectorId, 'questionnairePathMap', 'must be an object');
  }

  if (Object.keys(value).length === 0) {
    return undefined;
  }

  const entries: Record<string, string> = {};

  for (const [itemKey, itemValue] of Object.entries(value)) {
    const path = parseNonEmptyString(connectorId, itemValue, `questionnairePathMap.${itemKey}`);

    if (!path.includes('.')) {
      throw new KycConfigInvalidError(
        connectorId,
        `questionnairePathMap.${itemKey}`,
        'must be a "<section>.<item>" path',
      );
    }

    entries[itemKey] = path;
  }

  return entries;
};

const parseMaxAttemptsPerDocSet = (connectorId: string, value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new KycConfigInvalidError(
      connectorId,
      'maxAttemptsPerDocSet',
      'must be a positive integer',
    );
  }

  return value;
};

/**
 * Parses a KYC connector declaration's `config` into its typed shape. Throws
 * `KycConfigInvalidError` naming the offending key on any malformed or missing value.
 */
export function parseKycConfig(
  connectorId: string,
  config: Readonly<Record<string, unknown>>,
): KycConfig {
  const providerConfig = Object.fromEntries(
    Object.entries(config).filter(
      ([key]) => !(KERNEL_CONFIG_KEYS as readonly string[]).includes(key),
    ),
  );

  return {
    sourceKey: parseNonEmptyString(connectorId, config.sourceKey, 'sourceKey'),
    documents: parseDocuments(connectorId, config.documents),
    questionnairePathMap: parseQuestionnairePathMap(connectorId, config.questionnairePathMap),
    maxAttemptsPerDocSet: parseMaxAttemptsPerDocSet(connectorId, config.maxAttemptsPerDocSet),
    providerConfig,
  };
}
