import { isAxiosError } from 'axios';
import { z } from 'zod';
import { describeRequestFailure } from '@/shared/api/describe-request-failure';
import { httpClient } from '@/shared/api/http-client';
import { createPaginatedResponseSchema } from '@/shared/api/paginated-response';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, type PaginationWindow } from '@/shared/lib/pagination';
import { ONBOARDING_ENDPOINTS } from '../constants/endpoints';
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

const adminOnboardingsResponseSchema = createPaginatedResponseSchema(adminOnboardingSummarySchema);

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
  /** Page to read, defaulting to the first one. */
  page?: number;
}

/** One page of admin onboarding summaries together with the window the endpoint reported. */
export interface AdminOnboardingsPage {
  records: AdminOnboardingSummary[];
  pagination: PaginationWindow;
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
 * Fetches one page of the admin onboarding list from the configured engine origin. Normalizes the
 * draft filters into the endpoint's query params (blank values are omitted so Axios never
 * sends them, but the page window is always stated), issues one GET request, validates the
 * payload against the Zod schema, and returns the lifecycle-safe projection.
 */
export async function fetchAdminOnboardings(
  options: FetchAdminOnboardingsOptions = {},
): Promise<AdminOnboardingsPage> {
  const normalizedFilters = normalizeAdminOnboardingFilters(
    options.filters ?? {
      status: '',
      workflowId: '',
      workflowVersion: '',
      currentStep: '',
      onboardingId: '',
      limit: DEFAULT_PAGE_SIZE,
    },
    options.page ?? DEFAULT_PAGE,
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
      describeRequestFailure(status, cause, 'onboardings'),
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

  return {
    records: parsedPayload.data.items.map(projectAdminOnboardingSummary),
    pagination: parsedPayload.data.meta.pagination,
  };
}
