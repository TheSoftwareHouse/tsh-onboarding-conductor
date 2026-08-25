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
