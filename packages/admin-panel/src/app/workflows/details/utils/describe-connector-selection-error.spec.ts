import { describe, expect, it } from 'vitest';
import {
  WorkflowConnectorSelectionWriteError,
  type WorkflowConnectorSelectionReason,
} from '@/api/workflows/workflow-connector-selection';
import { describeConnectorSelectionError } from './describe-connector-selection-error';

function error(reason?: WorkflowConnectorSelectionReason, detail?: string) {
  return new WorkflowConnectorSelectionWriteError('engine message', 400, reason, detail);
}

describe('describeConnectorSelectionError', () => {
  it.each([
    ['type_mismatch', 'does not provide the capability'],
    ['async_unsupported', 'cannot answer by callback'],
    ['in_fallback_chain', 'already a fallback'],
    ['callback_fields_missing', 'does not declare every field'],
    ['fixture_not_allowed', 'test double'],
    ['adapter_not_registered', 'No adapter with this id'],
  ] as const)('explains %s', (reason, fragment) => {
    expect(describeConnectorSelectionError(error(reason, 'ignored'))).toContain(fragment);
  });

  it('falls back to the engine detail, then the message', () => {
    expect(describeConnectorSelectionError(error('declaration_invalid', 'bad doc'))).toBe(
      'bad doc',
    );
    expect(describeConnectorSelectionError(error('no_connector'))).toBe('engine message');
    expect(describeConnectorSelectionError(new WorkflowConnectorSelectionWriteError('plain'))).toBe(
      'plain',
    );
  });
});
