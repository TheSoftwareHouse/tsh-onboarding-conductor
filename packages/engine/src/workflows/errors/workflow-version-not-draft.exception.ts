import { ConflictException } from '@nestjs/common';

/** The addressed revision exists but is not a draft, so it is immutable. */
export class WorkflowVersionNotDraftException extends ConflictException {
  static readonly apiDescription =
    'The revision is not a draft; carries `workflowId`, `version` and `status`.';

  constructor(workflowId = '', version = 0, status = '') {
    super({
      code: 'WORKFLOW_VERSION_NOT_DRAFT',
      message: 'WORKFLOW_VERSION_NOT_DRAFT',
      workflowId,
      version,
      status,
    });
  }
}
