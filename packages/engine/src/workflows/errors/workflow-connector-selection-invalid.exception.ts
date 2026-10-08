import { BadRequestException } from '@nestjs/common';
import type { WorkflowConnectorSelectionInvalidReason } from '../domain/connector-selection';

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
