import { z } from 'zod';
import { invalidPayloadError, toApiError, type ApiError } from '@/services/api/api-error';
import { httpClient } from '@/services/api/http-client';

/** The engine path this module reads and writes, beside the only code that requests it. */
export const ADMIN_CONNECTORS_ENDPOINT = '/v1/admin/connectors';

/** Path to one connector's settings resource, used by both the replace and clear requests. */
export function connectorSettingsPath(connectorId: string): string {
  return `${ADMIN_CONNECTORS_ENDPOINT}/${encodeURIComponent(connectorId)}`;
}

const connectorSettingSchema = z.object({
  key: z.string(),
  secret: z.boolean(),
  required: z.boolean(),
  source: z.enum(['stored', 'unset']),
  value: z.string().optional(),
});

const connectorSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  configured: z.boolean(),
  settings: z.array(connectorSettingSchema),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});

const listConnectorsResponseSchema = z.object({
  connectors: z.array(connectorSchema),
});

const connectorSettingsIssueSchema = z.object({
  key: z.string(),
  reason: z.enum([
    'undeclared_key',
    'missing_required_key',
    'invalid_value',
    'invalid_format',
    'missing_pairing',
    'would_be_dropped',
  ]),
});

/** The one error body the engine sends alongside a rejected write; any other 400/500 body is ignored. */
const connectorSettingsInvalidBodySchema = z.object({
  code: z.literal('CONNECTOR_SETTINGS_INVALID'),
  issues: z.array(connectorSettingsIssueSchema),
});

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

/** Projects a validated record onto exactly the fields the card renders. */
function projectConnector(record: z.infer<typeof connectorSchema>): Connector {
  return {
    id: record.id,
    type: record.type,
    name: record.name,
    configured: record.configured,
    settings: record.settings.map((setting) => ({
      key: setting.key,
      secret: setting.secret,
      required: setting.required,
      source: setting.source,
      value: setting.value,
    })),
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
}

/** Reads the per-key issues from a rejected write, or an empty array for any other failure. */
export function readConnectorSettingsIssues(error: ApiError): ConnectorSettingsIssue[] {
  if (error.status !== 400) {
    return [];
  }

  const parsed = connectorSettingsInvalidBodySchema.safeParse(error.body);

  return parsed.success ? parsed.data.issues : [];
}

/**
 * Fetches every configurable connector from the configured engine origin. The endpoint is
 * unpaginated — four connectors today — so this issues one GET request, validates the payload
 * against the Zod schema, and returns the projected list.
 */
export async function fetchConnectors(): Promise<Connector[]> {
  let response;
  try {
    response = await httpClient.get<unknown>(ADMIN_CONNECTORS_ENDPOINT);
  } catch (cause) {
    throw toApiError(cause, 'connectors');
  }

  const parsedPayload = listConnectorsResponseSchema.safeParse(response.data);
  if (!parsedPayload.success) {
    throw invalidPayloadError('Response contains a malformed connector.');
  }

  return parsedPayload.data.connectors.map(projectConnector);
}

/**
 * Merges the given changes into one connector's stored settings. A string value overwrites the
 * stored key, `null` deletes it, and an absent key is left exactly as stored — so the caller
 * only ever sends what the operator actually changed, never a secret it does not hold.
 */
export async function patchConnectorSettings(
  connectorId: string,
  changes: Record<string, string | null>,
): Promise<Connector> {
  let response;
  try {
    response = await httpClient.patch<unknown>(connectorSettingsPath(connectorId), {
      settings: changes,
    });
  } catch (cause) {
    throw toApiError(cause, 'connectors');
  }

  const parsedPayload = connectorSchema.safeParse(response.data);
  if (!parsedPayload.success) {
    throw invalidPayloadError('Response contains a malformed connector.');
  }

  return projectConnector(parsedPayload.data);
}

/** Clears a connector's stored settings. The engine answers `204` with no body to validate. */
export async function deleteConnectorSettings(connectorId: string): Promise<void> {
  try {
    await httpClient.delete(connectorSettingsPath(connectorId));
  } catch (cause) {
    throw toApiError(cause, 'connectors');
  }
}
