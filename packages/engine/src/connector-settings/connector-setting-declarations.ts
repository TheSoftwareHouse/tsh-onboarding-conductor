import type { AppConfig } from '../config/app.config';

/**
 * Connector types whose credentials an operator may set from the admin panel. Declared here
 * rather than on the adapters so that the whole configurable surface is readable in one place,
 * the way `AppConfig` holds every env-driven setting, and so the adapters can depend on the
 * settings store without the store depending back on the adapter registry.
 */
export const TWILIO_VERIFY_CONNECTOR_TYPE = 'twilio_verify';
export const SENDGRID_EMAIL_CONNECTOR_TYPE = 'sendgrid_email';
export const SMTP_CONNECTOR_TYPE = 'smtp';

export type ConnectorSettingField = Readonly<{
  /** Stable key the value is stored and submitted under. */
  key: string;
  label: string;
  /** Where the value comes from when nothing is stored — the deployment-time default. */
  envVar: keyof AppConfig;
  /** Encrypted at rest and never returned by the admin API. */
  secret: boolean;
  /** The connector cannot run without a value from either source. */
  required: boolean;
  hint?: string;
}>;

export type ConnectorSettingGroup = Readonly<{
  label: string;
  fields: readonly ConnectorSettingField[];
}>;

/**
 * Only credentials and the identities they belong to are listed. Transport topology that a
 * deployment owns rather than an operator — whether SMTP is enabled at all, its port and TLS
 * mode, every timeout — stays env-only, so a panel edit can never make the engine talk plaintext
 * to a host it was not configured for.
 */
export const CONNECTOR_SETTING_DECLARATIONS = {
  [TWILIO_VERIFY_CONNECTOR_TYPE]: {
    label: 'Twilio Verify',
    fields: [
      {
        key: 'accountSid',
        label: 'Account SID',
        envVar: 'TWILIO_ACCOUNT_SID',
        secret: false,
        required: true,
      },
      {
        key: 'authToken',
        label: 'Auth token',
        envVar: 'TWILIO_AUTH_TOKEN',
        secret: true,
        required: true,
      },
      {
        key: 'verifyServiceSid',
        label: 'Verify service SID',
        envVar: 'TWILIO_VERIFY_SERVICE_SID',
        secret: false,
        required: true,
        hint: 'Console → Verify → Services, starts with VA.',
      },
    ],
  },
  [SENDGRID_EMAIL_CONNECTOR_TYPE]: {
    label: 'SendGrid email',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        envVar: 'SENDGRID_API_KEY',
        secret: true,
        required: true,
      },
      {
        key: 'from',
        label: 'Sender address',
        envVar: 'SENDGRID_FROM',
        secret: false,
        required: true,
        hint: 'Must be a verified SendGrid sender.',
      },
    ],
  },
  [SMTP_CONNECTOR_TYPE]: {
    label: 'SMTP',
    fields: [
      {
        key: 'host',
        label: 'Host',
        envVar: 'SMTP_HOST',
        secret: false,
        required: true,
      },
      {
        key: 'username',
        label: 'Username',
        envVar: 'SMTP_USERNAME',
        secret: false,
        required: false,
        hint: 'Leave both credential fields empty for an unauthenticated relay.',
      },
      {
        key: 'password',
        label: 'Password',
        envVar: 'SMTP_PASSWORD',
        secret: true,
        required: false,
      },
      {
        key: 'from',
        label: 'Sender address',
        envVar: 'SMTP_FROM',
        secret: false,
        required: true,
      },
    ],
  },
} as const satisfies Record<string, ConnectorSettingGroup>;

export type ConfigurableConnectorType = keyof typeof CONNECTOR_SETTING_DECLARATIONS;

/** The keys one connector declares, as a literal union, so a typo fails to compile. */
export type ConnectorSettingKey<TConnectorType extends ConfigurableConnectorType> =
  (typeof CONNECTOR_SETTING_DECLARATIONS)[TConnectorType]['fields'][number]['key'];

/** Effective values for one connector. A key is absent when neither source supplies it. */
export type ConnectorSettingValues<TConnectorType extends ConfigurableConnectorType> = Readonly<
  Partial<Record<ConnectorSettingKey<TConnectorType>, string>>
>;

/** Narrows a connector type off the wire to one that actually declares settings. */
export function isConfigurableConnectorType(
  connectorType: string,
): connectorType is ConfigurableConnectorType {
  return Object.prototype.hasOwnProperty.call(CONNECTOR_SETTING_DECLARATIONS, connectorType);
}

export function getConnectorSettingGroup(
  connectorType: ConfigurableConnectorType,
): ConnectorSettingGroup {
  return CONNECTOR_SETTING_DECLARATIONS[connectorType];
}

/** Every configurable connector in declaration order, which is the order the panel renders. */
export function getConfigurableConnectorTypes(): readonly ConfigurableConnectorType[] {
  return Object.keys(CONNECTOR_SETTING_DECLARATIONS) as ConfigurableConnectorType[];
}
