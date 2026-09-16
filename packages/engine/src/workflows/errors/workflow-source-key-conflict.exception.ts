import { ConflictException } from '@nestjs/common';

/** The submitted definition claims a `sourceKey` a stored workflow with another id already owns. */
export class WorkflowSourceKeyConflictException extends ConflictException {
  static readonly apiDescription =
    'Another stored workflow already owns this source key; carries `sourceKey` and ' +
    '`conflictingWorkflowId`.';

  constructor(sourceKey: string, conflictingWorkflowId: string) {
    super({
      code: 'WORKFLOW_SOURCE_KEY_CONFLICT',
      message: 'WORKFLOW_SOURCE_KEY_CONFLICT',
      sourceKey,
      conflictingWorkflowId,
    });
  }
}
