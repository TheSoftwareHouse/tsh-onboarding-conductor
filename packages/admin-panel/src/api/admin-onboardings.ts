import type { AdminOnboardingStatus, AdminOnboardingSummary } from '../types/admin-onboarding';

const ADMIN_ONBOARDINGS_PATH = '/v1/admin/onboardings';
const DEFAULT_BASE_URL = '/api';
const VALID_STATUSES: readonly AdminOnboardingStatus[] = ['awaiting_user', 'approved'];

export type AdminOnboardingsFetchErrorReason =
  'invalid-base-url' | 'network-error' | 'http-error' | 'invalid-json' | 'invalid-payload';

export interface AdminOnboardingsFetchError {
  reason: AdminOnboardingsFetchErrorReason;
  message: string;
  status?: number;
}

export type AdminOnboardingsFetchResult =
  { ok: true; data: AdminOnboardingSummary[] } | { ok: false; error: AdminOnboardingsFetchError };

export interface FetchAdminOnboardingsOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

function getDefaultBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL;
  return typeof configured === 'string' && configured.trim().length > 0
    ? configured
    : DEFAULT_BASE_URL;
}

/**
 * Accepts only a same-origin relative path (e.g. `/api`).
 * Rejects absolute URLs (`https://...`), protocol-relative URLs (`//host`), and empty values
 * so the browser can never bypass the Vite proxy and call the engine or another origin directly.
 */
function isRelativeBaseUrl(value: string): boolean {
  if (value.length === 0 || !value.startsWith('/') || value.startsWith('//')) {
    return false;
  }

  return !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isAdminOnboardingStatus(value: unknown): value is AdminOnboardingStatus {
  return typeof value === 'string' && (VALID_STATUSES as readonly string[]).includes(value);
}

function isAdminOnboardingSummary(value: unknown): value is AdminOnboardingSummary {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.onboardingId === 'string' &&
    typeof record.workflowId === 'string' &&
    typeof record.workflowVersion === 'number' &&
    Number.isInteger(record.workflowVersion) &&
    record.workflowVersion > 0 &&
    isAdminOnboardingStatus(record.status) &&
    isNullableString(record.currentStep) &&
    isNullableString(record.expiresAt) &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string' &&
    isNullableString(record.completedAt)
  );
}

/**
 * Projects a validated record onto exactly the nine lifecycle-safe fields,
 * dropping `context` and any other extra field the endpoint may include.
 */
function projectAdminOnboardingSummary(record: AdminOnboardingSummary): AdminOnboardingSummary {
  return {
    onboardingId: record.onboardingId,
    workflowId: record.workflowId,
    workflowVersion: record.workflowVersion,
    status: record.status,
    currentStep: record.currentStep,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
  };
}

/**
 * Fetches the complete, unfiltered admin onboarding list from the same-origin proxy route.
 * Never sends query parameters; filtering happens locally after a successful load.
 */
export async function fetchAdminOnboardings(
  options: FetchAdminOnboardingsOptions = {},
): Promise<AdminOnboardingsFetchResult> {
  const baseUrl = options.baseUrl ?? getDefaultBaseUrl();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!isRelativeBaseUrl(baseUrl)) {
    return {
      ok: false,
      error: {
        reason: 'invalid-base-url',
        message: `VITE_API_BASE_URL must be a relative, same-origin path, received "${baseUrl}".`,
      },
    };
  }

  const requestUrl = `${baseUrl}${ADMIN_ONBOARDINGS_PATH}`;

  let response: Response;
  try {
    response = await fetchImpl(requestUrl);
  } catch (cause) {
    return {
      ok: false,
      error: {
        reason: 'network-error',
        message: cause instanceof Error ? cause.message : 'Network request failed.',
      },
    };
  }

  if (response.status !== 200) {
    return {
      ok: false,
      error: {
        reason: 'http-error',
        message: `Request failed with status ${response.status}.`,
        status: response.status,
      },
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      error: {
        reason: 'invalid-json',
        message: 'Response body is not valid JSON.',
      },
    };
  }

  if (!Array.isArray(payload)) {
    return {
      ok: false,
      error: {
        reason: 'invalid-payload',
        message: 'Response payload is not an array.',
      },
    };
  }

  const records: AdminOnboardingSummary[] = [];

  for (const item of payload) {
    if (!isAdminOnboardingSummary(item)) {
      return {
        ok: false,
        error: {
          reason: 'invalid-payload',
          message: 'Response contains a malformed onboarding record.',
        },
      };
    }

    records.push(projectAdminOnboardingSummary(item));
  }

  return { ok: true, data: records };
}
