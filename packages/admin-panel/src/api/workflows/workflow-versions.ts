import { z } from 'zod';
import { invalidPayloadError, toApiError } from '@/services/api/api-error';
import { httpClient } from '@/services/api/http-client';
import { ADMIN_WORKFLOWS_ENDPOINT } from './workflow-definitions';

/** A stored revision's publication state, as the engine reports it. */
export const WORKFLOW_VERSION_STATUS = {
  published: 'published',
  draft: 'draft',
  retired: 'retired',
} as const;

export type WorkflowVersionStatus =
  (typeof WORKFLOW_VERSION_STATUS)[keyof typeof WORKFLOW_VERSION_STATUS];

const workflowVersionSchema = z.object({
  version: z.number().int().positive(),
  status: z.nativeEnum(WORKFLOW_VERSION_STATUS),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const workflowVersionsResponseSchema = z.object({ items: z.array(workflowVersionSchema) });

/** One stored revision of a workflow family, as the versions endpoint lists it. */
export type WorkflowVersion = z.infer<typeof workflowVersionSchema>;

/** Lists every stored version of a workflow, newest first, whatever its status. */
export async function fetchWorkflowVersions(workflowId: string): Promise<WorkflowVersion[]> {
  let response;
  try {
    response = await httpClient.get<unknown>(
      `${ADMIN_WORKFLOWS_ENDPOINT}/${encodeURIComponent(workflowId)}/versions`,
    );
  } catch (cause) {
    throw toApiError(cause, 'workflows');
  }

  const parsed = workflowVersionsResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    throw invalidPayloadError('Response contains a malformed workflow versions list.');
  }

  return parsed.data.items;
}
