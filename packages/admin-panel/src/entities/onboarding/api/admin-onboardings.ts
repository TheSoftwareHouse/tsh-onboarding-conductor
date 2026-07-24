import type { AdminOnboardingStatus, AdminOnboardingSummary } from '../model/admin-onboarding';
import {
  normalizeAdminOnboardingFilters,
  type AdminOnboardingFilters,
  type AdminOnboardingQueryFilters,
} from '../model/filter-admin-onboardings';

const ADMIN_ONBOARDINGS_PATH = '/v1/admin/onboardings';
const VALID_STATUSES: readonly AdminOnboardingStatus[] = ['awaiting_user', 'approved'];

export type AdminOnboardingsFetchErrorReason =
  | 'invalid-base-url'
  | 'invalid-input'
  | 'network-error'
  | 'http-error'
  | 'invalid-json'
  | 'invalid-payload';

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
  filters?: AdminOnboardingFilters;
}

function getDefaultBaseUrl(): string {
  const configured = import.meta.env.VITE_ENGINE_API_BASE_URL;
  return typeof configured === 'string' ? configured.trim() : '';
}

function isHttpOrHttpsOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isAbsoluteHttpOrigin(value: string): boolean {
  if (!isHttpOrHttpsOrigin(value)) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return (
      parsed.origin === value &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      parsed.username === '' &&
      parsed.password === ''
    );
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value: string): string | null {
  if (!isAbsoluteHttpOrigin(value)) {
    return null;
  }

  return new URL(value).origin;
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

function appendSupportedFilterParameters(
  searchParams: URLSearchParams,
  filters: AdminOnboardingQueryFilters,
): void {
  if (filters.status !== undefined) {
    searchParams.append('status', filters.status);
  }

  if (filters.workflowId !== undefined) {
    searchParams.append('workflowId', filters.workflowId);
  }

  if (filters.workflowVersion !== undefined) {
    searchParams.append('workflowVersion', filters.workflowVersion);
  }

  if (filters.currentStep !== undefined) {
    searchParams.append('currentStep', filters.currentStep);
  }

  if (filters.onboardingId !== undefined) {
    searchParams.append('onboardingId', filters.onboardingId);
  }
}

/**
 * Fetches the admin onboarding list from the configured engine origin.
 * Sends only supported validated query parameters when filters are provided.
 */
export async function fetchAdminOnboardings(
  options: FetchAdminOnboardingsOptions = {},
): Promise<AdminOnboardingsFetchResult> {
  const baseUrl = options.baseUrl ?? getDefaultBaseUrl();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (normalizedBaseUrl === null) {
    return {
      ok: false,
      error: {
        reason: 'invalid-base-url',
        message: `VITE_ENGINE_API_BASE_URL must be an absolute http(s) origin without a path, query, fragment, or credentials, received "${baseUrl}".`,
      },
    };
  }

  const normalizedFilters = normalizeAdminOnboardingFilters(
    options.filters ?? {
      status: '',
      workflowId: '',
      workflowVersion: '',
      currentStep: '',
      onboardingId: '',
    },
  );
  if (!normalizedFilters.ok) {
    return {
      ok: false,
      error: {
        reason: 'invalid-input',
        message: normalizedFilters.error.message,
      },
    };
  }

  const requestUrl = new URL(ADMIN_ONBOARDINGS_PATH, normalizedBaseUrl);
  const searchParams = new URLSearchParams();
  appendSupportedFilterParameters(searchParams, normalizedFilters.filters);
  requestUrl.search = searchParams.toString();

  let response: Response;
  try {
    response = await fetchImpl(requestUrl.toString());
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
