/**
 * What a connector does, mirroring `CONNECTOR_TYPES` in `@tsh/ddl-schema`'s
 * `workflow-contract.ts`. Kept as a local literal because the panel depends on the engine over
 * HTTP and should not pull server-only dependencies into the browser bundle. The order is the
 * order the connectors page groups by, so it reads capability-first rather than alphabetically.
 */
export const CONNECTOR_TYPES = [
  'kyc',
  'kyb',
  'aml',
  'credit',
  'phone_verification',
  'email_verification',
  'email_delivery',
  'sms_delivery',
  'bank_verification',
  'payment',
  'e_signature',
  'document_storage',
  'custom',
] as const;

export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export function isConnectorType(value: unknown): value is ConnectorType {
  return CONNECTOR_TYPES.includes(value as ConnectorType);
}

const CONNECTOR_TYPE_LABELS: Record<ConnectorType, string> = {
  kyc: 'Identity verification',
  kyb: 'Business verification',
  aml: 'Sanctions screening',
  credit: 'Credit assessment',
  phone_verification: 'Phone verification',
  email_verification: 'Email verification',
  email_delivery: 'Email delivery',
  sms_delivery: 'SMS delivery',
  bank_verification: 'Bank verification',
  payment: 'Payments',
  e_signature: 'E-signature',
  document_storage: 'Document storage',
  custom: 'Custom',
};

/**
 * Human-readable capability label, falling back to the raw value. The engine may add a capability
 * before the panel knows about it, and an unrecognized group must still render rather than vanish.
 */
export function describeConnectorType(type: string): string {
  return isConnectorType(type) ? CONNECTOR_TYPE_LABELS[type] : type;
}

export type ConnectorSettingSource = 'stored' | 'unset';

export interface ConnectorSetting {
  key: string;
  secret: boolean;
  required: boolean;
  source: ConnectorSettingSource;
  /** Present only for a non-secret stored value. */
  value?: string;
}

export interface Connector {
  /** The connector's own identifier, e.g. `twilio_verify`. */
  id: string;
  /**
   * What it does, e.g. `email_delivery` — the axis the page groups by. Left as a plain string
   * rather than `ConnectorType`: the engine owns the set, and a value this build has not heard of
   * must still render instead of failing payload validation.
   */
  type: string;
  name: string;
  configured: boolean;
  allowAdditionalKeys: boolean;
  settings: ConnectorSetting[];
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * Mirrors the engine's `ConnectorSettingsInvalidReason` union
 * (`connector-settings-invalid.exception.ts`) so a rejected write can be mapped to an
 * operator-facing sentence for every reason the engine may report.
 */
export type ConnectorSettingsIssueReason =
  | 'undeclared_key'
  | 'missing_required_key'
  | 'invalid_value'
  | 'invalid_format'
  | 'missing_pairing'
  | 'would_be_dropped';

export interface ConnectorSettingsIssue {
  key: string;
  reason: ConnectorSettingsIssueReason;
}
