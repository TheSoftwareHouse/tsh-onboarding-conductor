import { isAxiosError } from 'axios';
import { z } from 'zod';
import { describeRequestFailure } from '@/services/api/describe-request-failure';
import { httpClient } from '@/services/api/http-client';

/** The engine path this module reads, beside the only code that requests it. */
export const ADMIN_WORKFLOWS_ENDPOINT = '/v1/admin/workflows';

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

/** One transition a step declares, as the admin workflow endpoint reports it. */
export interface WorkflowTransitionDefinition {
  status: string;
  /** Step the transition moves to, or null when it re-enters the step it is declared on. */
  target: string | null;
  /**
   * Condition guarding the transition, absent when it always applies. Left as `unknown` on
   * purpose: it is a recursive document the panel only ever renders, so it is narrowed
   * defensively where it is formatted rather than mirrored as a schema a new operator would break.
   */
  when?: unknown;
}

export interface WorkflowStepDefinition {
  name: string;
  status: string;
  terminal: boolean;
  transitions: WorkflowTransitionDefinition[];
}

/** One score a workflow declares, as the admin workflow endpoint reports its bounds. */
export interface WorkflowScoreDefinition {
  min: number;
  max: number;
}

/** The shape of a workflow: every declared step, and the transitions between them. */
export interface WorkflowDefinition {
  workflowId: string;
  workflowVersion: number;
  initialStep: string;
  /** Declared scores keyed by name. Empty for a workflow that declares no scoring. */
  scores: Record<string, WorkflowScoreDefinition>;
  steps: WorkflowStepDefinition[];
}

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
      `${ADMIN_WORKFLOWS_ENDPOINT}/${encodeURIComponent(workflowId)}`,
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
