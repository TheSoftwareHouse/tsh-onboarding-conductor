import { ConflictException } from '@nestjs/common';

/** A pinned revision is still a draft, so it cannot be resolved to run. */
export class WorkflowVersionNotPublishedException extends ConflictException {
  static readonly apiDescription =
    'The pinned revision is a draft and cannot be started; carries `workflowId` and `version`.';

  constructor(workflowId = '', version = 0) {
    super({
      code: 'WORKFLOW_VERSION_NOT_PUBLISHED',
      message: 'WORKFLOW_VERSION_NOT_PUBLISHED',
      workflowId,
      version,
    });
  }
}
