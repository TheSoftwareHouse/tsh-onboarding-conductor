import { HttpStatusCode, isAxiosError } from 'axios';
import { z } from 'zod';
import { httpClient } from '@/shared/api/http-client';
import { ONBOARDING_ENDPOINTS } from '../constants/endpoints';
import { ADMIN_ONBOARDING_STATUSES } from '../types/admin-onboarding';
import type { AdminOnboardingSummary } from '../types/admin-onboarding';
import {
  normalizeAdminOnboardingFilters,
  type AdminOnboardingFilters,
} from '../utils/filter-admin-onboardings';

const adminOnboardingSummarySchema = z.object({
  onboardingId: z.string(),
  workflowId: z.string(),
  workflowVersion: z.number().int().positive(),
  // Any non-empty status is accepted. Pinning this to a literal union meant a single unexpected
  // value — a status added by a migration — rejected the entire response and left the operator
  // with no list at all.
  status: z.string().min(1),
  currentStep: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});

const adminOnboardingsResponseSchema = z.array(adminOnboardingSummarySchema);

export type AdminOnboardingsFetchErrorReason =
  'invalid-input' | 'request-failed' | 'invalid-payload';

export class AdminOnboardingsFetchError extends Error {
  readonly reason: AdminOnboardingsFetchErrorReason;
  readonly status?: number;

  constructor(reason: AdminOnboardingsFetchErrorReason, message: string, status?: number) {
    super(message);
    this.name = 'AdminOnboardingsFetchError';
    this.reason = reason;
    this.status = status;
  }
}

export interface FetchAdminOnboardingsOptions {
  filters?: AdminOnboardingFilters;
}

/**
 * Projects a validated record onto exactly the nine lifecycle-safe fields,
 * dropping `context` and any other extra field the endpoint may include.
 */
function projectAdminOnboardingSummary(
  record: z.infer<typeof adminOnboardingSummarySchema>,
): AdminOnboardingSummary {
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
 * Turns a failed request into something an operator can act on. The three authentication-related
 * statuses each call for a different response — sign in again, ask for a role, or wait — and a
 * bare status code tells the operator none of that.
 */
function describeRequestFailure(status: number | undefined, cause: unknown): string {
  switch (status) {
    case HttpStatusCode.Unauthorized:
      return 'Your session is no longer accepted by the engine. Sign in again.';
    case HttpStatusCode.Forbidden:
      return 'Your account is signed in but is not assigned a role that may view onboardings.';
    case HttpStatusCode.ServiceUnavailable:
      // The engine could not reach Entra to check the token. Nothing is wrong with the session,
      // so signing in again would not help and the operator should simply retry.
      return 'The engine cannot verify sign-ins right now. This is not a problem with your account — try again shortly.';
    case undefined:
      return cause instanceof Error ? cause.message : 'Request failed.';
    default:
      return `Request failed with status ${status}.`;
  }
}

/**
 * Fetches the admin onboarding list from the configured engine origin. Normalizes the
 * draft filters into the endpoint's query params (blank values are omitted so Axios never
 * sends them), issues one GET request, validates the payload against the Zod schema, and
 * returns the lifecycle-safe projection.
 */
export async function fetchAdminOnboardings(
  options: FetchAdminOnboardingsOptions = {},
): Promise<AdminOnboardingSummary[]> {
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
    throw new AdminOnboardingsFetchError('invalid-input', normalizedFilters.error.message);
  }

  let response;
  try {
    response = await httpClient.get<unknown>(ONBOARDING_ENDPOINTS.adminOnboardings, {
      params: normalizedFilters.filters,
    });
  } catch (cause) {
    const status = isAxiosError(cause) ? cause.response?.status : undefined;
    throw new AdminOnboardingsFetchError(
      'request-failed',
      describeRequestFailure(status, cause),
      status,
    );
  }

  const parsedPayload = adminOnboardingsResponseSchema.safeParse(response.data);
  if (!parsedPayload.success) {
    throw new AdminOnboardingsFetchError(
      'invalid-payload',
      'Response contains a malformed onboarding record.',
    );
  }

  return parsedPayload.data.map(projectAdminOnboardingSummary);
}
