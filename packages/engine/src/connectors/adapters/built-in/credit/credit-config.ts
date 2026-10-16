/** Bands on the provider's own score scale. */
export type CreditBands = Readonly<{ approveFrom: number; reviewFrom: number }>;

export const CREDIT_REPORT_MODES = ['full', 'summary', 'none'] as const;

export type CreditReportMode = (typeof CREDIT_REPORT_MODES)[number];

export const DEFAULT_CREDIT_PRODUCTS: readonly string[] = ['creditScore', 'paymentScore'];

/**
 * The workflow declaration's `config`, parsed: exactly the four keys the `credit-assessment` step
 * type compiles into the connector declaration (the step's `applicant` roles become its
 * `fieldMapping`, its `bankDataMaxSizeBytes` the upload's validation; neither reaches here).
 * `providerConfig` is every key no kernel rule consumed, so a provider's own keys reach it wherever
 * they were authored. `maxAttempts` carries no code default: an operator who omits it gets a parse
 * failure naming the key.
 */
export type CreditConfig = {
  readonly bands: CreditBands;
  readonly maxAttempts: number;
  readonly products: readonly string[];
  readonly report: CreditReportMode;
  readonly providerConfig: Readonly<Record<string, unknown>>;
};

/**
 * A malformed credit connector declaration `config` — a startup-time authoring defect, not a
 * client-facing error, per `packages/engine/CLAUDE.md`'s two-tier error contract.
 */
export class CreditConfigInvalidError extends Error {
  constructor(connectorId: string, key: string, reason: string) {
    super(`Invalid ${connectorId} connector config key "${key}": ${reason}`);
    this.name = 'CreditConfigInvalidError';
  }
}

const KERNEL_CONFIG_KEYS = ['bands', 'maxAttempts', 'products', 'report'] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseNonEmptyString = (connectorId: string, value: unknown, key: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CreditConfigInvalidError(connectorId, key, 'must be a non-empty string');
  }

  return value.trim();
};

const parsePositiveInteger = (connectorId: string, value: unknown, key: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new CreditConfigInvalidError(connectorId, key, 'must be a positive integer');
  }

  return value;
};

const parseBands = (connectorId: string, value: unknown): CreditBands => {
  if (!isPlainObject(value)) {
    throw new CreditConfigInvalidError(connectorId, 'bands', 'must be an object');
  }

  const [approveFrom, reviewFrom] = (['approveFrom', 'reviewFrom'] as const).map((name) => {
    const threshold = value[name];

    if (typeof threshold !== 'number' || !Number.isFinite(threshold)) {
      throw new CreditConfigInvalidError(connectorId, `bands.${name}`, 'must be a number');
    }

    return threshold;
  });

  if (approveFrom <= reviewFrom) {
    throw new CreditConfigInvalidError(
      connectorId,
      'bands.approveFrom',
      'must be greater than bands.reviewFrom',
    );
  }

  return { approveFrom, reviewFrom };
};

const parseProducts = (connectorId: string, value: unknown): readonly string[] => {
  if (value === undefined) {
    return DEFAULT_CREDIT_PRODUCTS;
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new CreditConfigInvalidError(connectorId, 'products', 'must be a non-empty array');
  }

  return value.map((product, index) =>
    parseNonEmptyString(connectorId, product, `products[${index}]`),
  );
};

const parseReportMode = (connectorId: string, value: unknown): CreditReportMode => {
  if (value === undefined) {
    return 'full';
  }

  if (!(CREDIT_REPORT_MODES as readonly unknown[]).includes(value)) {
    throw new CreditConfigInvalidError(
      connectorId,
      'report',
      `must be one of ${CREDIT_REPORT_MODES.join(', ')}`,
    );
  }

  return value as CreditReportMode;
};

/**
 * Parses a credit connector declaration's `config` into its typed shape. Throws
 * `CreditConfigInvalidError` naming the offending key on any malformed or missing value.
 */
export function parseCreditConfig(
  connectorId: string,
  config: Readonly<Record<string, unknown>>,
): CreditConfig {
  const providerConfig = Object.fromEntries(
    Object.entries(config).filter(
      ([key]) => !(KERNEL_CONFIG_KEYS as readonly string[]).includes(key),
    ),
  );

  return {
    bands: parseBands(connectorId, config.bands),
    maxAttempts: parsePositiveInteger(connectorId, config.maxAttempts, 'maxAttempts'),
    products: parseProducts(connectorId, config.products),
    report: parseReportMode(connectorId, config.report),
    providerConfig,
  };
}
