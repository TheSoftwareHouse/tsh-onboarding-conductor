/** Which of the two sources the effective value comes from, or that there is none. */
export type ConnectorSettingSource = 'database' | 'environment' | 'unset';

export class ConnectorSettingFieldResponseDto {
  key!: string;
  label!: string;
  secret!: boolean;
  required!: boolean;
  hint?: string;
  source!: ConnectorSettingSource;
  /** Always null for a secret: a stored credential is never read back over the API. */
  value!: string | null;
}

export class ConnectorSettingsResponseDto {
  connectorType!: string;
  label!: string;
  fields!: ConnectorSettingFieldResponseDto[];
}

export class ListConnectorSettingsResponseDto {
  items!: ConnectorSettingsResponseDto[];
}
