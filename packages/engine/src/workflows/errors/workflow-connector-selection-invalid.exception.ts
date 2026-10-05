import { BadRequestException } from '@nestjs/common';

/** Why a stored version refuses the connector an operator asked a step to run. */
export const WORKFLOW_CONNECTOR_SELECTION_INVALID_REASONS = [
  'no_connector',
  'multiple_connectors',
  'in_fallback_chain',
  'adapter_not_registered',
  'fixture_not_allowed',
  'type_mismatch',
  'async_unsupported',
  'callback_fields_missing',
  'declaration_invalid',
] as const;

export type WorkflowConnectorSelectionInvalidReason =
  (typeof WORKFLOW_CONNECTOR_SELECTION_INVALID_REASONS)[number];

export class WorkflowConnectorSelectionInvalidException extends BadRequestException {
  static readonly apiDescription =
    'The connector cannot serve the step in at least one non-retired version; carries `stepName`, ' +
    '`connectorId`, the `workflowVersion` that refused it, a `reason` of `no_connector`, ' +
    '`multiple_connectors`, `in_fallback_chain`, `adapter_not_registered`, `fixture_not_allowed`, ' +
    '`type_mismatch`, `async_unsupported`, `callback_fields_missing` or `declaration_invalid`, ' +
    'and a `detail` when the refusal has more to say.';

  constructor(
    stepName: string,
    connectorId: string,
    workflowVersion: number,
    reason: WorkflowConnectorSelectionInvalidReason,
    detail?: string,
  ) {
    super({
      code: 'WORKFLOW_CONNECTOR_SELECTION_INVALID',
      message: 'WORKFLOW_CONNECTOR_SELECTION_INVALID',
      stepName,
      connectorId,
      workflowVersion,
      reason,
      ...(detail === undefined ? {} : { detail }),
    });
  }
}
