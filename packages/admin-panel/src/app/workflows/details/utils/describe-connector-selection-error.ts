import type {
  WorkflowConnectorSelectionReason,
  WorkflowConnectorSelectionWriteError,
} from '@/api/workflows/workflow-connector-selection';

const REASON_SENTENCES: Record<WorkflowConnectorSelectionReason, string> = {
  no_connector: 'This step declares no connector to replace.',
  multiple_connectors:
    'This step declares more than one connector, so its name cannot say which one to replace.',
  in_fallback_chain: 'This connector is already a fallback on this step.',
  adapter_not_registered: 'No adapter with this id is registered.',
  fixture_not_allowed: 'A test double cannot serve a step in production.',
  type_mismatch: 'This connector does not provide the capability this step’s connector declares.',
  async_unsupported: 'This connector cannot answer by callback, and this step waits for one.',
  callback_fields_missing: 'This step does not declare every field the connector reports.',
  declaration_invalid:
    'This connector does not accept the step’s connector declaration as authored.',
};

/**
 * The sentence an operator reads when the engine refuses a selection. It names the version that
 * refused, because a family has several and the step may differ between them, and it prefers the
 * engine's `detail` — which names the missing field or the offending config key — to the panel's
 * generic sentence; a reason this build does not know falls back to the engine's own message.
 */
export function describeConnectorSelectionError(
  error: WorkflowConnectorSelectionWriteError,
): string {
  const { refusal } = error;

  if (refusal === undefined) {
    return error.message;
  }

  const sentence = (REASON_SENTENCES as Partial<Record<string, string>>)[refusal.reason];

  return `Version ${refusal.workflowVersion} refused: ${refusal.detail ?? sentence ?? error.message}`;
}
