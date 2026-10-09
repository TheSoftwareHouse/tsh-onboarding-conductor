import { ConflictException } from '@nestjs/common';

/** The `id` names a family that lives in a scope drafts cannot write to. */
export class WorkflowScopeConflictException extends ConflictException {
  static readonly apiDescription =
    'The workflow id belongs to a family in another scope; carries `workflowId` and `scope`.';

  constructor(workflowId = '', scope = '') {
    super({
      code: 'WORKFLOW_SCOPE_CONFLICT',
      message: 'WORKFLOW_SCOPE_CONFLICT',
      workflowId,
      scope,
    });
  }
}
