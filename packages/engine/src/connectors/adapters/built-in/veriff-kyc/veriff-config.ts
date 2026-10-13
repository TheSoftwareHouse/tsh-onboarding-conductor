import type { ConnectorSettingsSchema } from '../../../ports/connector-adapter.port';

/**
 * Both are operator-provided connector settings configured through the admin API
 * (`PUT /v1/admin/connectors/veriff_kyc`), not environment variables.
 *
 * `apiKey` identifies the integration (`X-AUTH-CLIENT`). Veriff signs both directions with the
 * shared secret, so `sharedSecretKey` is also the key the adapter's `callbackAuth.secretSettingKey`
 * names for inbound verification. A rotation window is a comma-separated list: the first entry
 * signs outbound, every entry verifies inbound — so a secret containing a comma cannot be stored.
 */
export const VERIFF_KYC_SETTINGS_SCHEMA: ConnectorSettingsSchema = {
  fields: [
    { key: 'apiKey', secret: false, required: true },
    { key: 'sharedSecretKey', secret: true, required: true },
  ],
};

export type VeriffSettingsReader = { get(key: string): string };

/** Resolves the pair the client needs; `sharedSecretKey` is the first rotation entry, trimmed. */
export const resolveVeriffCredentials = (
  settings: VeriffSettingsReader,
): { apiKey: string; sharedSecretKey: string } => ({
  apiKey: settings.get('apiKey'),
  sharedSecretKey: settings.get('sharedSecretKey').split(',')[0].trim(),
});
