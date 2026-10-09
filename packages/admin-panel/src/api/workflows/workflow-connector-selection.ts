import { HttpStatusCode } from 'axios';
import { z } from 'zod';
import { invalidPayloadError, toApiError, type ApiError } from '@/services/api/api-error';
import { httpClient } from '@/services/api/http-client';
import {
  ADMIN_WORKFLOWS_ENDPOINT,
  workflowPrimaryConnectorSchema,
  type WorkflowStepConnectorWithFallbacks,
} from './workflow-definitions';

const RESOURCE_LABEL = 'workflows';

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

/** What the engine says when a stored version refuses the choice: which version, why, and in its own words. */
export type WorkflowConnectorSelectionRefusal = {
  message: string;
  stepName: string;
  connectorId: string;
  workflowVersion: number;
  reason: WorkflowConnectorSelectionReason;
  detail?: string;
};

/** The refusal a `400 WORKFLOW_CONNECTOR_SELECTION_INVALID` carries, or `null` for any other failure. */
export function readConnectorSelectionRefusal(
  error: ApiError,
): WorkflowConnectorSelectionRefusal | null {
  if (error.status !== HttpStatusCode.BadRequest) return null;

  const parsed = selectionInvalidBodySchema.safeParse(error.body);
  if (!parsed.success) return null;

  const { message, stepName, connectorId, workflowVersion, reason, detail } = parsed.data;

  return {
    message,
    stepName,
    connectorId,
    workflowVersion,
    reason: reason as WorkflowConnectorSelectionReason,
    detail,
  };
}

function selectionPath(workflowId: string, stepName: string): string {
  return `${ADMIN_WORKFLOWS_ENDPOINT}/${encodeURIComponent(workflowId)}/steps/${encodeURIComponent(stepName)}/connector`;
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
    throw toApiError(cause, RESOURCE_LABEL);
  }

  const parsed = workflowPrimaryConnectorSchema.safeParse(response.data);
  if (!parsed.success) {
    throw invalidPayloadError('Response contains a malformed connector.');
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
    throw toApiError(cause, RESOURCE_LABEL);
  }
}
