import type {
  ConnectorSettingSource,
  ConnectorSettingsView,
  ConnectorSettingView,
} from '../connector-settings-admin.service';

export type ConnectorSettingResponse = {
  key: string;
  secret: boolean;
  required: boolean;
  source: ConnectorSettingSource;
  /** Present only when `secret` is false; a secret's value never leaves the engine. */
  value?: string;
};

export type ConnectorSettingsResponse = {
  type: string;
  name: string;
  /** True when every required key resolves to a value. */
  configured: boolean;
  /** True when the adapter accepts keys beyond its declared `fields`. */
  allowAdditionalKeys: boolean;
  settings: ConnectorSettingResponse[];
  updatedAt: string | null;
  updatedBy: string | null;
};

export type ConnectorSettingsListResponse = {
  connectors: ConnectorSettingsResponse[];
};

function toConnectorSettingResponse(setting: ConnectorSettingView): ConnectorSettingResponse {
  return {
    key: setting.key,
    secret: setting.secret,
    required: setting.required,
    source: setting.source,
    value: setting.value,
  };
}

/** The service returns `updatedAt` as a `Date`; this is the one place it becomes ISO text. */
export function toConnectorSettingsResponse(
  view: ConnectorSettingsView,
): ConnectorSettingsResponse {
  return {
    type: view.type,
    name: view.name,
    configured: view.configured,
    allowAdditionalKeys: view.allowAdditionalKeys,
    settings: view.settings.map(toConnectorSettingResponse),
    updatedAt: view.updatedAt === null ? null : view.updatedAt.toISOString(),
    updatedBy: view.updatedBy,
  };
}
