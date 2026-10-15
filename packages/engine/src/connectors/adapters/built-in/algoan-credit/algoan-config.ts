import type { ConnectorSettingsSchema } from '../../../ports/connector-adapter.port';
import { CreditConfigInvalidError } from '../credit/credit-config';
import type { AlgoanCredentials } from './algoan-contract';

export const ALGOAN_CREDIT_CONNECTOR_ID = 'algoan_credit';

/** Header Algoan signs its webhooks with, and the prefix of its value. */
export const ALGOAN_HEADER_SIGNATURE = 'X-Hub-Signature';
export const ALGOAN_SIGNATURE_PREFIX = 'sha256=';

export const ALGOAN_EVENT_ANALYSIS_COMPLETED = 'analysis_completed';
export const ALGOAN_EVENT_ANALYSIS_FAILED = 'analysis_failed';

export const DEFAULT_ALGOAN_CURRENCY = 'GBP';

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Operator-provided connector settings (`PUT /v1/admin/connectors/algoan_credit`). Algoan signs
 * with a per-subscription secret the operator chooses, so it is its own setting rather than the
 * API client secret.
 */
export const ALGOAN_CREDIT_SETTINGS_SCHEMA: ConnectorSettingsSchema = {
  fields: [
    { key: 'clientId', secret: false, required: true },
    { key: 'clientSecret', secret: true, required: true },
    { key: 'callbackSigningSecret', secret: true, required: true },
  ],
};

export type AlgoanSettingsReader = { get(key: string): string };

export const resolveAlgoanCredentials = (settings: AlgoanSettingsReader): AlgoanCredentials => ({
  clientId: settings.get('clientId'),
  clientSecret: settings.get('clientSecret'),
});

export type AlgoanProviderConfig = Readonly<{ currency: string }>;

/** The declaration keys no kernel rule consumed: only `currency`, an ISO 4217 code. */
export function parseAlgoanProviderConfig(
  providerConfig: Readonly<Record<string, unknown>>,
): AlgoanProviderConfig {
  const { currency = DEFAULT_ALGOAN_CURRENCY } = providerConfig;

  if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency)) {
    throw new CreditConfigInvalidError(
      ALGOAN_CREDIT_CONNECTOR_ID,
      'currency',
      'must be an upper-case ISO 4217 code such as GBP',
    );
  }

  return { currency };
}
