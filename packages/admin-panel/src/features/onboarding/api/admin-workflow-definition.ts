import { isAxiosError } from 'axios';
import { z } from 'zod';
import { describeRequestFailure } from '@/shared/api/describe-request-failure';
import { httpClient } from '@/shared/api/http-client';
import { ONBOARDING_ENDPOINTS } from '../constants/endpoints';
import type { WorkflowDefinition } from '../types/workflow-definition';

const workflowTransitionSchema = z.object({
  status: z.string().min(1),
  target: z.string().nullable(),
  // Rendered, never evaluated, so the guard document is accepted as-is (see WorkflowTransitionDefinition).
  when: z.unknown(),
});

const workflowStepSchema = z.object({
  name: z.string().min(1),
  status: z.string().min(1),
  terminal: z.boolean(),
  transitions: z.array(workflowTransitionSchema),
});

const workflowDefinitionSchema = z.object({
  workflowId: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  name: z.string(),
  initialStep: z.string().min(1),
  steps: z.array(workflowStepSchema),
});

export type WorkflowDefinitionFetchErrorReason = 'request-failed' | 'invalid-payload';

export class WorkflowDefinitionFetchError extends Error {
  readonly reason: WorkflowDefinitionFetchErrorReason;
  readonly status?: number;

  constructor(reason: WorkflowDefinitionFetchErrorReason, message: string, status?: number) {
    super(message);
    this.name = 'WorkflowDefinitionFetchError';
    this.reason = reason;
    this.status = status;
  }
}

/**
 * Reads one workflow's declared shape. The version the onboarding was started on is pinned, so a
 * panel never draws an onboarding against a definition it did not run under.
 */
export async function fetchWorkflowDefinition(
  workflowId: string,
  workflowVersion: number,
): Promise<WorkflowDefinition> {
  let response;
  try {
    response = await httpClient.get<unknown>(
      `${ONBOARDING_ENDPOINTS.adminWorkflows}/${encodeURIComponent(workflowId)}`,
      { params: { version: workflowVersion } },
    );
  } catch (cause) {
    const status = isAxiosError(cause) ? cause.response?.status : undefined;
    throw new WorkflowDefinitionFetchError(
      'request-failed',
      describeRequestFailure(status, cause, 'workflows'),
      status,
    );
  }

  const parsed = workflowDefinitionSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new WorkflowDefinitionFetchError(
      'invalid-payload',
      'Response contains a malformed workflow definition.',
    );
  }

  return parsed.data;
}
