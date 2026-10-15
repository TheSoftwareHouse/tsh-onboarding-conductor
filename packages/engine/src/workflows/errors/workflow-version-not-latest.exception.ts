import { ConflictException } from '@nestjs/common';

/** A published version of the family is at or above the draft's, so publishing it would not make it the latest. */
export class WorkflowVersionNotLatestException extends ConflictException {
  static readonly apiDescription =
    "The family already has a published version at or above the draft's; carries " +
    '`workflowId`, `version` and `latestPublishedVersion`.';

  constructor(workflowId = '', version = 0, latestPublishedVersion = 0) {
    super({
      code: 'WORKFLOW_VERSION_NOT_LATEST',
      message: 'WORKFLOW_VERSION_NOT_LATEST',
      workflowId,
      version,
      latestPublishedVersion,
    });
  }
}
