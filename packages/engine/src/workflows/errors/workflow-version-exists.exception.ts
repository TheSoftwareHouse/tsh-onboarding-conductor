import { ConflictException } from '@nestjs/common';

/** The target `id` and `version` already name a stored revision, in any status. */
export class WorkflowVersionExistsException extends ConflictException {
  static readonly apiDescription =
    'A revision with this workflow id and version already exists; carries `workflowId` and `version`.';

  constructor(workflowId = '', version = 0) {
    super({
      code: 'WORKFLOW_VERSION_EXISTS',
      message: 'WORKFLOW_VERSION_EXISTS',
      workflowId,
      version,
    });
  }
}
