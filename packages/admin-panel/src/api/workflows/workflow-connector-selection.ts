import { isAxiosError } from 'axios';
import { z } from 'zod';
import { describeRequestFailure } from '@/services/api/describe-request-failure';
import { httpClient } from '@/services/api/http-client';
import {
  ADMIN_WORKFLOWS_ENDPOINT,
  workflowPrimaryConnectorSchema,
  type WorkflowStepConnectorWithFallbacks,
} from './workflow-definitions';

/** Why the engine refused a selection, mirroring the `reason` of `WORKFLOW_CONNECTOR_SELECTION_INVALID`. */
export type WorkflowConnectorSelectionReason =
  | 'no_connector'
  | 'multiple_connectors'
  | 'in_fallback_chain'
  | 'adapter_not_registered'
  | 'fixture_not_allowed'
  | 'type_mismatch'
  | 'async_unsupported'
  | 'callback_fields_missing'
  | 'declaration_invalid';

/** The one 400 body that explains a refusal; any other body is ignored. */
const selectionInvalidBodySchema = z.object({
  code: z.literal('WORKFLOW_CONNECTOR_SELECTION_INVALID'),
  message: z.string(),
  stepName: z.string(),
  connectorId: z.string(),
  workflowVersion: z.number(),
  // A reason this build has not heard of must still surface its message, not fail the parse.
  reason: z.string(),
  detail: z.string().optional(),
});

/** What the engine says when a stored version refuses the choice: which version, and why. */
export type WorkflowConnectorSelectionRefusal = {
  stepName: string;
  connectorId: string;
  workflowVersion: number;
  reason: WorkflowConnectorSelectionReason;
  detail?: string;
};

export class WorkflowConnectorSelectionWriteError extends Error {
  readonly status?: number;
  /** Present only for 400 WORKFLOW_CONNECTOR_SELECTION_INVALID. */
  readonly refusal?: WorkflowConnectorSelectionRefusal;

  constructor(message: string, status?: number, refusal?: WorkflowConnectorSelectionRefusal) {
    super(message);
    this.name = 'WorkflowConnectorSelectionWriteError';
    this.status = status;
    this.refusal = refusal;
  }
}

function selectionPath(workflowId: string, stepName: string): string {
  return `${ADMIN_WORKFLOWS_ENDPOINT}/${encodeURIComponent(workflowId)}/steps/${encodeURIComponent(stepName)}/connector`;
}

function toWriteError(cause: unknown): WorkflowConnectorSelectionWriteError {
  const status = isAxiosError(cause) ? cause.response?.status : undefined;
  const body = selectionInvalidBodySchema.safeParse(
    isAxiosError(cause) && status === 400 ? cause.response?.data : undefined,
  );
  if (body.success) {
    const { message, reason, ...refusal } = body.data;

    return new WorkflowConnectorSelectionWriteError(message, status, {
      ...refusal,
      reason: reason as WorkflowConnectorSelectionReason,
    });
  }

  return new WorkflowConnectorSelectionWriteError(
    describeRequestFailure(status, cause, 'workflows'),
    status,
  );
}

/** Serves a step's connector slot with another adapter of its type, for every version of the workflow. */
export async function putWorkflowConnectorSelection(
  workflowId: string,
  stepName: string,
  connectorId: string,
): Promise<WorkflowStepConnectorWithFallbacks> {
  let response;
  try {
    response = await httpClient.put<unknown>(selectionPath(workflowId, stepName), { connectorId });
  } catch (cause) {
    throw toWriteError(cause);
  }

  const parsed = workflowPrimaryConnectorSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new WorkflowConnectorSelectionWriteError('Response contains a malformed connector.');
  }

  return parsed.data;
}

/** Drops the runtime selection so the slot is served by the connector the document declares. The engine answers `204`. */
export async function deleteWorkflowConnectorSelection(
  workflowId: string,
  stepName: string,
): Promise<void> {
  try {
    await httpClient.delete(selectionPath(workflowId, stepName));
  } catch (cause) {
    throw toWriteError(cause);
  }
}
