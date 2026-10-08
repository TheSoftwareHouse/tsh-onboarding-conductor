import { HttpStatusCode, isAxiosError } from 'axios';
import { z } from 'zod';
import { describeRequestFailure } from '@/services/api/describe-request-failure';
import { httpClient } from '@/services/api/http-client';
import { createPaginatedResponseSchema } from '@/services/api/paginated-response';
import { DEFAULT_PAGE, type PaginationWindow } from '@/lib/pagination';

/** The onboardings resource root; the transitions and review modules build their paths under it. */
export const ADMIN_ONBOARDINGS_ENDPOINT = '/v1/onboardings';

/**
 * Statuses the engine can report, mirroring `WORKFLOW_STATUSES` in `@tsh/ddl-schema`'s
 * `workflow-contract.ts` and the `onboardings.status` CHECK constraint. Kept as a local literal
 * because the panel depends on the engine over HTTP and should not pull server-only dependencies
 * into the browser bundle.
 */
export const ADMIN_ONBOARDING_STATUSES = [
  'awaiting_user',
  'awaiting_manual_review',
  'approved',
  'rejected',
  'invalid',
] as const;

export type AdminOnboardingStatus = (typeof ADMIN_ONBOARDING_STATUSES)[number];

/** Whether the engine defines this status, narrowing the string the caller already holds. */
export function isAdminOnboardingStatus(value: unknown): value is AdminOnboardingStatus {
  return ADMIN_ONBOARDING_STATUSES.includes(value as AdminOnboardingStatus);
}

/**
 * The connector an onboarding is parked on while it waits for the provider's verdict. `parkedAt`
 * is null for a park the engine recorded before it stamped the instant.
 */
const adminOnboardingPendingConnectorSchema = z.object({
  connectorId: z.string(),
  connectorName: z.string(),
  connectorOrder: z.number().int(),
  parkedAt: z.string().nullable(),
});

/** Exported so the reconcile module validates the summary it is answered with the same way. */
export const adminOnboardingSummarySchema = z.object({
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
  // Absent on a response from an engine build that predates scoring; defaults to an empty map
  // rather than failing the whole record, so the panel keeps rendering it.
  scores: z.record(z.string(), z.number()).default({}),
  // Absent on a response from an engine build that predates parking; defaults to "not parked"
  // for the same deployment-skew reason as `scores`.
  pendingConnector: adminOnboardingPendingConnectorSchema.nullable().default(null),
});

const paginatedOnboardingsResponseSchema = createPaginatedResponseSchema(
  adminOnboardingSummarySchema,
);

/**
 * The bare array this endpoint returned before it was paginated. Still accepted for the same
 * reason an unrecognized `status` is (see above): the panel and the engine are deployed
 * separately, so a panel that is one release ahead must not blank out the operator's whole list.
 * An engine still on this shape ignores the page window and answers with every matching row.
 */
const unpaginatedOnboardingsResponseSchema = z.array(adminOnboardingSummarySchema);

export type AdminOnboardingsFetchErrorReason = 'request-failed' | 'invalid-payload';

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

/**
 * Lifecycle-safe projection of the engine's admin onboarding summary.
 * Deliberately excludes `context` and any other field the endpoint may return.
 */
export interface AdminOnboardingSummary {
  onboardingId: string;
  workflowId: string;
  workflowVersion: number;
  /**
   * Intentionally not narrowed to `AdminOnboardingStatus`. A migration that adds a status must
   * not blank out the whole list for an operator, so an unrecognized value is displayed as-is
   * rather than failing validation.
   */
  status: string;
  currentStep: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /**
   * Declared workflow scores keyed by name. Empty for a workflow that declares no scoring, and
   * also empty for a response from an engine build that predates this field — never absent, so
   * a caller never has to guard against `undefined` on top of an empty map.
   */
  scores: Record<string, number>;
  /**
   * The connector the onboarding is parked on, or null when it is not waiting on one — also null
   * for a response from an engine build that predates the field, so a caller never guards
   * against `undefined`.
   */
  pendingConnector: AdminOnboardingPendingConnector | null;
}

/** The connector an onboarding waits on; `parkedAt` is null when the engine did not record the instant. */
export type AdminOnboardingPendingConnector = z.infer<typeof adminOnboardingPendingConnectorSchema>;

/** One page of admin onboarding summaries together with the window the endpoint reported. */
export interface AdminOnboardingsPage {
  records: AdminOnboardingSummary[];
  pagination: PaginationWindow;
}

/** The endpoint's supported query keys; every criterion is `null` when absent. See ADR 0018. */
export interface AdminOnboardingQueryFilters {
  page: number;
  limit: number;
  status: AdminOnboardingStatus | null;
  workflowId: string | null;
  workflowVersion: string | null;
  currentStep: string | null;
  onboardingId: string | null;
  /** `true` narrows to onboardings parked on a connector; the panel never asks for `false`. */
  parked: boolean | null;
  pendingConnectorId: string | null;
  /** ISO-8601 instant; an onboarding parked before the engine stamped `parkedAt` never matches. */
  parkedBefore: string | null;
}

/**
 * Projects a validated record onto exactly the lifecycle-safe fields, dropping `context` and any
 * other extra field the endpoint may include. Exported so the reconcile module projects the
 * summary it is answered with the same way.
 */
export function projectAdminOnboardingSummary(
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
    scores: record.scores,
    pendingConnector: record.pendingConnector,
  };
}

/**
 * Reads either list shape the engine may answer with, or null when the payload is neither.
 *
 * A response that carries no page window is the one and only page by definition, so it is reported
 * as such rather than left absent - callers render the window they are given, and an absent one
 * would read as "nothing was returned".
 */
function readOnboardingsPage(payload: unknown, limit: number): AdminOnboardingsPage | null {
  const paginated = paginatedOnboardingsResponseSchema.safeParse(payload);
  if (paginated.success) {
    return {
      records: paginated.data.items.map(projectAdminOnboardingSummary),
      pagination: paginated.data.meta.pagination,
    };
  }

  const unpaginated = unpaginatedOnboardingsResponseSchema.safeParse(payload);
  if (unpaginated.success) {
    const records = unpaginated.data.map(projectAdminOnboardingSummary);

    return {
      records,
      pagination: {
        page: DEFAULT_PAGE,
        limit,
        total: records.length,
        totalPages: records.length > 0 ? 1 : 0,
      },
    };
  }

  return null;
}

/**
 * Fetches one page of the admin onboarding list from the configured engine origin. `filters` is
 * already normalized by the caller (every criterion either a real value or `null`, the page
 * window always stated), so this issues one GET request with it as-is - axios drops a `null`
 * param on its own - validates the payload against the Zod schema, and returns the lifecycle-safe
 * projection.
 */
export async function fetchAdminOnboardings(
  filters: AdminOnboardingQueryFilters,
): Promise<AdminOnboardingsPage> {
  let response;
  try {
    response = await httpClient.get<unknown>(ADMIN_ONBOARDINGS_ENDPOINT, {
      params: filters,
    });
  } catch (cause) {
    const status = isAxiosError(cause) ? cause.response?.status : undefined;
    throw new AdminOnboardingsFetchError(
      'request-failed',
      describeRequestFailure(status, cause, 'onboardings'),
      status,
    );
  }

  const page = readOnboardingsPage(response.data, filters.limit);
  if (page === null) {
    throw new AdminOnboardingsFetchError(
      'invalid-payload',
      'Response contains a malformed onboarding record.',
    );
  }

  return page;
}

/**
 * Reads one onboarding by id. Returns null for an id the engine holds no record of, which the
 * details page reports as "matched nothing" rather than treating as a failure — every other status
 * is a genuine refusal and is raised.
 */
export async function fetchAdminOnboardingById(
  onboardingId: string,
): Promise<AdminOnboardingSummary | null> {
  let response;
  try {
    response = await httpClient.get<unknown>(
      `${ADMIN_ONBOARDINGS_ENDPOINT}/${encodeURIComponent(onboardingId)}`,
    );
  } catch (cause) {
    const status = isAxiosError(cause) ? cause.response?.status : undefined;
    if (status === HttpStatusCode.NotFound) {
      return null;
    }

    throw new AdminOnboardingsFetchError(
      'request-failed',
      describeRequestFailure(status, cause, 'onboardings'),
      status,
    );
  }

  const record = adminOnboardingSummarySchema.safeParse(response.data);
  if (!record.success) {
    throw new AdminOnboardingsFetchError(
      'invalid-payload',
      'Response contains a malformed onboarding record.',
    );
  }

  return projectAdminOnboardingSummary(record.data);
}
