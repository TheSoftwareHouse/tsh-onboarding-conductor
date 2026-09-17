import { CONNECTOR_TYPES, type ConnectorType } from '@tsh/ddl-schema/workflow-contract';

/**
 * The capability vocabulary is the engine's, so it is imported from `@tsh/ddl-schema` rather than
 * restated here — a second copy would drift the moment a capability is added, and the panel would
 * silently stop grouping the new one. The `workflow-contract` subpath is deliberate: it is plain
 * constants and types with no runtime dependencies, so importing it pulls nothing else (notably
 * not `ajv`) into the browser bundle, which importing the package root would. The alias resolves
 * to that package's TypeScript source, not its `dist`, so the panel needs no build of it.
 *
 * `CONNECTOR_TYPES`' own order is the order the connectors page groups by — capability-first
 * rather than alphabetical — so the panel keeps no second ordering list either. Only the labels
 * are the panel's, and `Record<ConnectorType, string>` makes adding a capability upstream fail
 * this file's typecheck until it is given one, which is the drift the duplicated list used to
 * hide.
 */
export { CONNECTOR_TYPES };
export type { ConnectorType };

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
