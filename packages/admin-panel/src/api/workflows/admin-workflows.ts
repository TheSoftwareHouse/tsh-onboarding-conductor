import { z } from 'zod';
import { invalidPayloadError, toApiError } from '@/services/api/api-error';
import { httpClient } from '@/services/api/http-client';
import { createPaginatedResponseSchema } from '@/services/api/paginated-response';
import type { PaginationWindow } from '@/lib/pagination';
import { ADMIN_WORKFLOWS_ENDPOINT } from './workflow-definitions';

/** The list endpoint; the same resource root `workflow-definitions.ts` reads one workflow under. */
export const ADMIN_WORKFLOWS_LIST = ADMIN_WORKFLOWS_ENDPOINT;

/** Scope families the engine loads workflows under, mirroring `WORKFLOW_SCOPES` in `workflow-scope.ts`. */
export const WORKFLOW_SCOPES = ['built-in', 'fixtures', 'users'] as const;

export type WorkflowScope = (typeof WORKFLOW_SCOPES)[number];

const adminWorkflowSummarySchema = z.object({
  workflowId: z.string(),
  name: z.string().nullable(),
  scope: z.enum(WORKFLOW_SCOPES),
  servingVersion: z.number().int().positive().nullable(),
  versionCount: z.number().int().nonnegative(),
  draftCount: z.number().int().nonnegative(),
  inProgressCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const paginatedAdminWorkflowsResponseSchema = createPaginatedResponseSchema(
  adminWorkflowSummarySchema,
);

/** One workflow family as the admin workflows list reports it. */
export interface AdminWorkflowSummary {
  workflowId: string;
  name: string | null;
  scope: WorkflowScope;
  servingVersion: number | null;
  versionCount: number;
  draftCount: number;
  inProgressCount: number;
  createdAt: string;
  updatedAt: string;
}

/** One page of admin workflow summaries together with the window the endpoint reported. */
export interface AdminWorkflowsPage {
  records: AdminWorkflowSummary[];
  pagination: PaginationWindow;
}

/** The endpoint's supported query keys; every criterion is `null` when absent. See ADR 0018. */
export interface AdminWorkflowQueryFilters {
  page: number;
  limit: number;
  search: string | null;
  scope: WorkflowScope | null;
  hasDraft: boolean | null;
}

/** Projects a validated record onto exactly the nine fields the table renders. */
function projectAdminWorkflowSummary(
  record: z.infer<typeof adminWorkflowSummarySchema>,
): AdminWorkflowSummary {
  return {
    workflowId: record.workflowId,
    name: record.name,
    scope: record.scope,
    servingVersion: record.servingVersion,
    versionCount: record.versionCount,
    draftCount: record.draftCount,
    inProgressCount: record.inProgressCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Every other absent criterion is already `null` and needs no filtering - axios drops a `null` param on its own. `hasDraft` travels only when `true`, since `false` also means "no filter". */
function toRequestParams(filters: AdminWorkflowQueryFilters): Record<string, unknown> {
  const { hasDraft, ...params } = filters;
  return hasDraft === true ? { ...params, hasDraft: true } : params;
}

/** Fetches one page of the admin workflow list, validated against the Zod schema. */
export async function fetchAdminWorkflows(
  filters: AdminWorkflowQueryFilters,
): Promise<AdminWorkflowsPage> {
  let response;
  try {
    response = await httpClient.get<unknown>(ADMIN_WORKFLOWS_LIST, {
      params: toRequestParams(filters),
    });
  } catch (cause) {
    throw toApiError(cause, 'workflows');
  }

  const parsedPayload = paginatedAdminWorkflowsResponseSchema.safeParse(response.data);
  if (!parsedPayload.success) {
    throw invalidPayloadError('Response contains a malformed workflow summary.');
  }

  return {
    records: parsedPayload.data.items.map(projectAdminWorkflowSummary),
    pagination: parsedPayload.data.meta.pagination,
  };
}
