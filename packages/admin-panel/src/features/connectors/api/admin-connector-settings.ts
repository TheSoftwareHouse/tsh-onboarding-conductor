import { isAxiosError } from 'axios';
import { z } from 'zod';
import { describeRequestFailure } from '@/shared/api/describe-request-failure';
import { httpClient } from '@/shared/api/http-client';
import { CONNECTOR_ENDPOINTS } from '../constants/endpoints';
import {
  CONNECTOR_SETTING_SOURCES,
  type ConnectorSettingField,
  type ConnectorSettings,
  type ConnectorSettingValues,
} from '../types/connector-settings';

const connectorSettingFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  secret: z.boolean(),
  required: z.boolean(),
  hint: z.string().optional(),
  source: z.enum(CONNECTOR_SETTING_SOURCES),
  value: z.string().nullable(),
});

const connectorSettingsSchema = z.object({
  connectorType: z.string().min(1),
  label: z.string().min(1),
  fields: z.array(connectorSettingFieldSchema),
});

const listConnectorSettingsResponseSchema = z.object({
  items: z.array(connectorSettingsSchema),
});

/**
 * Engine error codes an operator can act on. Anything else falls back to the shared
 * status-based wording.
 */
const ENGINE_ERROR_MESSAGES: Record<string, string> = {
  CONNECTOR_SETTINGS_ENCRYPTION_UNAVAILABLE:
    'The engine has no encryption key configured, so it will not store a secret. Set CONNECTOR_SETTINGS_ENCRYPTION_KEY on the engine, then save again.',
  CONNECTOR_SETTINGS_NOT_CONFIGURABLE: 'This connector no longer accepts settings.',
  INVALID_CONNECTOR_SETTINGS: 'The engine refused one of these values.',
};

export type ConnectorSettingsFetchErrorReason = 'request-failed' | 'invalid-payload';

export class ConnectorSettingsFetchError extends Error {
  readonly reason: ConnectorSettingsFetchErrorReason;
  readonly status?: number;

  constructor(reason: ConnectorSettingsFetchErrorReason, message: string, status?: number) {
    super(message);
    this.name = 'ConnectorSettingsFetchError';
    this.reason = reason;
    this.status = status;
  }
}

/** Projects a validated field onto exactly what the form renders. */
function projectField(record: z.infer<typeof connectorSettingFieldSchema>): ConnectorSettingField {
  return {
    key: record.key,
    label: record.label,
    secret: record.secret,
    required: record.required,
    ...(record.hint === undefined ? {} : { hint: record.hint }),
    source: record.source,
    value: record.value,
  };
}

function projectConnector(record: z.infer<typeof connectorSettingsSchema>): ConnectorSettings {
  return {
    connectorType: record.connectorType,
    label: record.label,
    fields: record.fields.map(projectField),
  };
}

function toFetchError(cause: unknown): ConnectorSettingsFetchError {
  const response = isAxiosError(cause) ? cause.response : undefined;
  const code = (response?.data as { code?: unknown } | undefined)?.code;
  const engineMessage = typeof code === 'string' ? ENGINE_ERROR_MESSAGES[code] : undefined;

  return new ConnectorSettingsFetchError(
    'request-failed',
    engineMessage ?? describeRequestFailure(response?.status, cause, 'connector settings'),
    response?.status,
  );
}

export async function fetchConnectorSettings(): Promise<ConnectorSettings[]> {
  let response;
  try {
    response = await httpClient.get<unknown>(CONNECTOR_ENDPOINTS.adminConnectorSettings);
  } catch (cause) {
    throw toFetchError(cause);
  }

  const parsedPayload = listConnectorSettingsResponseSchema.safeParse(response.data);
  if (!parsedPayload.success) {
    throw new ConnectorSettingsFetchError(
      'invalid-payload',
      'Response contains a malformed connector setting.',
    );
  }

  return parsedPayload.data.items.map(projectConnector);
}

/**
 * Stores the submitted values for one connector and returns its settings as they now stand.
 * Only the keys an operator actually edited are sent: the engine leaves the rest untouched, so a
 * secret never has to be re-typed to save the field beside it.
 */
export async function saveConnectorSettings(
  connectorType: string,
  values: ConnectorSettingValues,
): Promise<ConnectorSettings> {
  let response;
  try {
    response = await httpClient.put<unknown>(
      `${CONNECTOR_ENDPOINTS.adminConnectorSettings}/${encodeURIComponent(connectorType)}`,
      { values },
    );
  } catch (cause) {
    throw toFetchError(cause);
  }

  const parsedPayload = connectorSettingsSchema.safeParse(response.data);
  if (!parsedPayload.success) {
    throw new ConnectorSettingsFetchError(
      'invalid-payload',
      'The engine reported the saved settings in a shape this panel does not understand.',
    );
  }

  return projectConnector(parsedPayload.data);
}
