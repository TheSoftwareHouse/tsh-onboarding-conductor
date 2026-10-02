import { isAxiosError } from 'axios';
import { z } from 'zod';
import { describeRequestFailure } from '@/services/api/describe-request-failure';
import { httpClient } from '@/services/api/http-client';

/** The engine root for admin workflow reads, shared by the definition and list modules. */
export const ADMIN_WORKFLOWS_ENDPOINT = '/v1/admin/workflows';

const workflowTransitionSchema = z.object({
  status: z.string().min(1),
  target: z.string().nullable(),
  // Rendered, never evaluated, so the guard document is accepted as-is (see WorkflowTransitionDefinition).
  when: z.unknown(),
  // Absent on a response from an engine build that predates it; null means the arm claims any reason.
  reason: z.array(z.string()).nullable().default(null),
});

const workflowStepSourceSchema = z.object({
  step: z.string(),
  type: z.string(),
  category: z.string(),
});

const workflowFieldUploadSchema = z.object({
  contentTypes: z.array(z.string()),
  maxSizeBytes: z.number(),
  maxImageWidth: z.number().optional(),
  maxImageHeight: z.number().optional(),
});

const workflowFieldSchema = z.object({
  name: z.string().min(1),
  type: z.string(),
  required: z.boolean(),
  persist: z.boolean(),
  when: z.unknown(),
  schema: z.record(z.string(), z.unknown()).default({}),
  upload: workflowFieldUploadSchema.nullable().default(null),
});

const workflowStepConnectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  order: z.number(),
  canReject: z.boolean(),
  async: z.boolean(),
  fieldMapping: z.record(z.string(), z.string()).default({}),
  optionalFieldMapping: z.record(z.string(), z.string()).default({}),
});

const workflowStepSchema = z.object({
  name: z.string().min(1),
  status: z.string().min(1),
  terminal: z.boolean(),
  transitions: z.array(workflowTransitionSchema),
  // The new step keys are absent on an engine build that predates them.
  source: workflowStepSourceSchema.nullable().default(null),
  fields: z.array(workflowFieldSchema).default([]),
  connectors: z
    .array(
      workflowStepConnectorSchema.extend({
        fallbacks: z.array(workflowStepConnectorSchema).default([]),
      }),
    )
    .default([]),
});

const workflowScoreSchema = z.object({
  min: z.number(),
  max: z.number(),
});

const workflowDefinitionSchema = z.object({
  workflowId: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  // Absent on a response from an engine build that predates the label; null then, as when no
  // version of the workflow declares one.
  name: z.string().nullable().default(null),
  initialStep: z.string().min(1),
  // Absent on a response from an engine build that predates scoring; defaults to an empty map
  // rather than failing the whole definition, so the panel keeps rendering it.
  scores: z.record(z.string(), workflowScoreSchema).default({}),
  webhook: z
    .object({ notify: z.object({ path: z.string() }) })
    .nullable()
    .default(null),
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
  /** Refusal reasons the arm claims, or null when it claims any. */
  reason: string[] | null;
}

/** The authored step a compiled step came from; null on a step the engine had no report for. */
export type WorkflowStepSource = z.infer<typeof workflowStepSourceSchema>;

/** One data field a step collects, with the constraints the state route serves for it. */
export interface WorkflowFieldDefinition {
  name: string;
  type: string;
  required: boolean;
  persist: boolean;
  when?: unknown;
  /** The JSON Schema fragment for the field's value. */
  schema: Record<string, unknown>;
  upload: WorkflowFieldUpload | null;
}

export type WorkflowFieldUpload = z.infer<typeof workflowFieldUploadSchema>;

/** A connector a step declares: identity and field mapping only, never its config. */
export type WorkflowStepConnector = z.infer<typeof workflowStepConnectorSchema>;

export type WorkflowStepConnectorWithFallbacks = WorkflowStepConnector & {
  fallbacks: WorkflowStepConnector[];
};

export interface WorkflowStepDefinition {
  name: string;
  status: string;
  terminal: boolean;
  transitions: WorkflowTransitionDefinition[];
  source: WorkflowStepSource | null;
  fields: WorkflowFieldDefinition[];
  connectors: WorkflowStepConnectorWithFallbacks[];
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
  /** The label the workflow's newest stored version declares, or null when none does. */
  name: string | null;
  initialStep: string;
  /** Declared scores keyed by name. Empty for a workflow that declares no scoring. */
  scores: Record<string, WorkflowScoreDefinition>;
  /** The state-change webhook the workflow declares, or null. */
  webhook: { notify: { path: string } } | null;
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
 * Reads one workflow's declared shape, pinned to `workflowVersion` when given; unpinned, the engine
 * serves the highest published version, else the highest of any status.
 */
export async function fetchWorkflowDefinition(
  workflowId: string,
  workflowVersion?: number,
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
