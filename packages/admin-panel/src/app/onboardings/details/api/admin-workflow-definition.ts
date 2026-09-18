import { isAxiosError } from 'axios';
import { z } from 'zod';
import { describeRequestFailure } from '@/services/api/describe-request-failure';
import { httpClient } from '@/services/api/http-client';
import { ONBOARDING_ENDPOINTS } from '../../constants/endpoints';
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

const workflowScoreSchema = z.object({
  min: z.number(),
  max: z.number(),
});

const workflowDefinitionSchema = z.object({
  workflowId: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  initialStep: z.string().min(1),
  // Absent on a response from an engine build that predates scoring; defaults to an empty map
  // rather than failing the whole definition, so the panel keeps rendering it.
  scores: z.record(z.string(), workflowScoreSchema).default({}),
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
