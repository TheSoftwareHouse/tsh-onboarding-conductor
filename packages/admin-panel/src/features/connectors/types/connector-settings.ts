/**
 * Where a connector setting takes effect from, mirroring the engine's own three states: stored by
 * an operator, inherited from the engine's environment, or supplied by neither.
 */
export const CONNECTOR_SETTING_SOURCES = ['database', 'environment', 'unset'] as const;

export type ConnectorSettingSource = (typeof CONNECTOR_SETTING_SOURCES)[number];

const SOURCE_LABELS: Record<ConnectorSettingSource, string> = {
  database: 'Saved here',
  environment: 'From the engine environment',
  unset: 'Not set',
};

export function describeConnectorSettingSource(source: ConnectorSettingSource): string {
  return SOURCE_LABELS[source];
}

/** One editable setting of one connector, as the admin endpoint reports it. */
export interface ConnectorSettingField {
  key: string;
  label: string;
  /** Never carries a value: a stored secret is reported as saved and nothing more. */
  secret: boolean;
  required: boolean;
  hint?: string;
  source: ConnectorSettingSource;
  value: string | null;
}

/** One connector and everything an operator may configure on it. */
export interface ConnectorSettings {
  connectorType: string;
  label: string;
  fields: ConnectorSettingField[];
}

/** The values one save submits: setting key to the value typed, empty meaning "clear this". */
export type ConnectorSettingValues = Record<string, string>;
