import { describe, expect, it } from 'vitest';
import type { WorkflowConnectorSelectionReason } from '@/api/workflows/workflow-connector-selection';
import { ApiError } from '@/services/api/api-error';
import { describeConnectorSelectionError } from './describe-connector-selection-error';

/** The 400 as `toApiError` hands it on: the generic message, with the engine's body behind it. */
function refused(reason: WorkflowConnectorSelectionReason, detail?: string, workflowVersion = 2) {
  return new ApiError('Request failed with status 400.', {
    status: 400,
    code: 'WORKFLOW_CONNECTOR_SELECTION_INVALID',
    body: {
      code: 'WORKFLOW_CONNECTOR_SELECTION_INVALID',
      message: 'engine message',
      stepName: 'verify',
      connectorId: 'veriff_kyc',
      workflowVersion,
      reason,
      detail,
    },
  });
}

describe('describeConnectorSelectionError', () => {
  it.each([
    ['no_connector', 'declares no connector'],
    ['multiple_connectors', 'more than one connector'],
    ['in_fallback_chain', 'already a fallback'],
    ['adapter_not_registered', 'No adapter with this id'],
    ['fixture_not_allowed', 'test double'],
    ['type_mismatch', 'does not provide the capability'],
    ['async_unsupported', 'cannot answer by callback'],
    ['callback_fields_missing', 'does not declare every field'],
    ['declaration_invalid', 'does not accept the step’s connector declaration'],
  ] as const)('explains %s, naming the version that refused', (reason, fragment) => {
    const text = describeConnectorSelectionError(refused(reason));

    expect(text).toMatch(/^Version 2 refused: /);
    expect(text).toContain(fragment);
  });

  it("prefers the engine's detail to the sentence", () => {
    expect(
      describeConnectorSelectionError(
        refused('callback_fields_missing', 'the step does not declare "kycAttemptCount"', 1),
      ),
    ).toBe('Version 1 refused: the step does not declare "kycAttemptCount"');
  });

  it("falls back to the engine's message for a reason it does not know", () => {
    expect(
      describeConnectorSelectionError(
        refused('not_yet_a_reason' as WorkflowConnectorSelectionReason),
      ),
    ).toBe('Version 2 refused: engine message');
  });

  it('reads the message alone without a refusal', () => {
    expect(describeConnectorSelectionError(new ApiError('plain', { status: 404 }))).toBe('plain');
  });
});
