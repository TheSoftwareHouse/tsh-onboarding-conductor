import type { ConnectorSettingsSchema } from '../../../ports/connector-adapter.port';

/**
 * Operator-provided connector settings configured through the admin API
 * (`PUT /v1/admin/connectors/lean_iban_verification` and `.../lean_bank_data`), not environment
 * variables. `clientId` is the portal's "app token"; the same pair is stored under both ids
 * because the two adapters share one Lean application.
 */
export const LEAN_IBAN_SETTINGS: ConnectorSettingsSchema = {
  fields: [
    { key: 'clientId', secret: false, required: true },
    { key: 'clientSecret', secret: true, required: true },
  ],
};

/**
 * `callbackSigningSecret` is Lean's "webhook secret" — the key `callbackAuth.secretSettingKey`
 * names for inbound HMAC verification.
 */
export const LEAN_BANK_DATA_SETTINGS: ConnectorSettingsSchema = {
  fields: [
    ...LEAN_IBAN_SETTINGS.fields,
    { key: 'callbackSigningSecret', secret: true, required: true },
  ],
};
