import { ConflictException } from '@nestjs/common';

/** The family already holds a draft; it holds at most one. */
export class WorkflowDraftExistsException extends ConflictException {
  static readonly apiDescription =
    'The workflow already has a draft; carries `workflowId` and `draftVersion`.';

  constructor(workflowId = '', draftVersion = 0) {
    super({
      code: 'WORKFLOW_DRAFT_EXISTS',
      message: 'WORKFLOW_DRAFT_EXISTS',
      workflowId,
      draftVersion,
    });
  }
}
