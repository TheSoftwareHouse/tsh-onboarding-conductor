import type { WorkflowConnectorSelectionWriteError } from '@/api/workflows/workflow-connector-selection';

const REASON_SENTENCES: Partial<
  Record<NonNullable<WorkflowConnectorSelectionWriteError['reason']>, string>
> = {
  type_mismatch: 'This connector does not provide the capability this step’s connector declares.',
  async_unsupported: 'This connector cannot answer by callback, and this step waits for one.',
  in_fallback_chain: 'This connector is already a fallback on this step.',
  callback_fields_missing: 'This step does not declare every field the connector reports.',
  fixture_not_allowed: 'A test double cannot serve a step in production.',
  adapter_not_registered: 'No adapter with this id is registered.',
};

/** The sentence an operator reads when the engine refuses a selection; the engine's own words for reasons it adds later. */
export function describeConnectorSelectionError(
  error: WorkflowConnectorSelectionWriteError,
): string {
  const sentence = error.reason === undefined ? undefined : REASON_SENTENCES[error.reason];

  return sentence ?? error.detail ?? error.message;
}
