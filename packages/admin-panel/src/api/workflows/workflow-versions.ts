import { isAxiosError } from 'axios';
import { z } from 'zod';
import { describeRequestFailure } from '@/services/api/describe-request-failure';
import { httpClient } from '@/services/api/http-client';
import { ADMIN_WORKFLOWS_ENDPOINT } from './workflow-definitions';

export const WORKFLOW_VERSION_STATUSES = ['published', 'draft', 'retired'] as const;

export type WorkflowVersionStatus = (typeof WORKFLOW_VERSION_STATUSES)[number];

const workflowVersionSchema = z.object({
  version: z.number().int().positive(),
  status: z.enum(WORKFLOW_VERSION_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const workflowVersionsResponseSchema = z.object({ items: z.array(workflowVersionSchema) });

/** One stored revision of a workflow family, as the versions endpoint lists it. */
export type WorkflowVersion = z.infer<typeof workflowVersionSchema>;

export type WorkflowVersionsFetchErrorReason = 'request-failed' | 'invalid-payload';

export class WorkflowVersionsFetchError extends Error {
  readonly reason: WorkflowVersionsFetchErrorReason;
  readonly status?: number;

  constructor(reason: WorkflowVersionsFetchErrorReason, message: string, status?: number) {
    super(message);
    this.name = 'WorkflowVersionsFetchError';
    this.reason = reason;
    this.status = status;
  }
}

/** Lists every stored version of a workflow, newest first, whatever its status. */
export async function fetchWorkflowVersions(workflowId: string): Promise<WorkflowVersion[]> {
  let response;
  try {
    response = await httpClient.get<unknown>(
      `${ADMIN_WORKFLOWS_ENDPOINT}/${encodeURIComponent(workflowId)}/versions`,
    );
  } catch (cause) {
    const status = isAxiosError(cause) ? cause.response?.status : undefined;
    throw new WorkflowVersionsFetchError(
      'request-failed',
      describeRequestFailure(status, cause, 'workflows'),
      status,
    );
  }

  const parsed = workflowVersionsResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new WorkflowVersionsFetchError(
      'invalid-payload',
      'Response contains a malformed workflow versions list.',
    );
  }

  return parsed.data.items;
}
