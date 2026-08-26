import { isAxiosError } from 'axios';
import { z } from 'zod';
import { describeRequestFailure } from '@/shared/api/describe-request-failure';
import { httpClient } from '@/shared/api/http-client';
import { CONNECTOR_ENDPOINTS, connectorSettingsPath } from '../constants/endpoints';
import type { Connector, ConnectorSettingsIssue } from '../types/connector';

const connectorSettingSchema = z.object({
  key: z.string(),
  secret: z.boolean(),
  required: z.boolean(),
  source: z.enum(['stored', 'unset']),
  value: z.string().optional(),
});

const connectorSchema = z.object({
  type: z.string(),
  name: z.string(),
  configured: z.boolean(),
  allowAdditionalKeys: z.boolean(),
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

export type ConnectorsFetchErrorReason = 'request-failed' | 'invalid-payload';

export class ConnectorsFetchError extends Error {
  readonly reason: ConnectorsFetchErrorReason;
  readonly status?: number;

  constructor(reason: ConnectorsFetchErrorReason, message: string, status?: number) {
    super(message);
    this.name = 'ConnectorsFetchError';
    this.reason = reason;
    this.status = status;
  }
}

export class ConnectorSettingsWriteError extends Error {
  readonly status?: number;
  /** Present only for 400 CONNECTOR_SETTINGS_INVALID. */
  readonly issues: ConnectorSettingsIssue[];

  constructor(message: string, status?: number, issues: ConnectorSettingsIssue[] = []) {
    super(message);
    this.name = 'ConnectorSettingsWriteError';
    this.status = status;
    this.issues = issues;
  }
}

/** Projects a validated record onto exactly the fields the card renders. */
function projectConnector(record: z.infer<typeof connectorSchema>): Connector {
  return {
    type: record.type,
    name: record.name,
    configured: record.configured,
    allowAdditionalKeys: record.allowAdditionalKeys,
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
function parseConnectorSettingsIssues(cause: unknown): ConnectorSettingsIssue[] {
  if (!isAxiosError(cause) || cause.response?.status !== 400) {
    return [];
  }

  const parsed = connectorSettingsInvalidBodySchema.safeParse(cause.response.data);

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
    response = await httpClient.get<unknown>(CONNECTOR_ENDPOINTS.adminConnectors);
  } catch (cause) {
    const status = isAxiosError(cause) ? cause.response?.status : undefined;
    throw new ConnectorsFetchError(
      'request-failed',
      describeRequestFailure(status, cause, 'connectors'),
      status,
    );
  }

  const parsedPayload = listConnectorsResponseSchema.safeParse(response.data);
  if (!parsedPayload.success) {
    throw new ConnectorsFetchError('invalid-payload', 'Response contains a malformed connector.');
  }

  return parsedPayload.data.connectors.map(projectConnector);
}

/**
 * Merges the given changes into one connector's stored settings. A string value overwrites the
 * stored key, `null` deletes it, and an absent key is left exactly as stored — so the caller
 * only ever sends what the operator actually changed, never a secret it does not hold.
 */
export async function patchConnectorSettings(
  connectorType: string,
  changes: Record<string, string | null>,
): Promise<Connector> {
  let response;
  try {
    response = await httpClient.patch<unknown>(connectorSettingsPath(connectorType), {
      settings: changes,
    });
  } catch (cause) {
    const status = isAxiosError(cause) ? cause.response?.status : undefined;
    throw new ConnectorSettingsWriteError(
      describeRequestFailure(status, cause, 'connectors'),
      status,
      parseConnectorSettingsIssues(cause),
    );
  }

  const parsedPayload = connectorSchema.safeParse(response.data);
  if (!parsedPayload.success) {
    throw new ConnectorSettingsWriteError('Response contains a malformed connector.');
  }

  return projectConnector(parsedPayload.data);
}

/** Clears a connector's stored settings. The engine answers `204` with no body to validate. */
export async function deleteConnectorSettings(connectorType: string): Promise<void> {
  try {
    await httpClient.delete(connectorSettingsPath(connectorType));
  } catch (cause) {
    const status = isAxiosError(cause) ? cause.response?.status : undefined;
    throw new ConnectorSettingsWriteError(
      describeRequestFailure(status, cause, 'connectors'),
      status,
      parseConnectorSettingsIssues(cause),
    );
  }
}
