import { ConflictException } from '@nestjs/common';

/** The submitted definition claims a `sourceKey` a stored workflow with another id already owns. */
export class WorkflowSourceKeyConflictException extends ConflictException {
  constructor(sourceKey: string, conflictingWorkflowId: string) {
    super({
      code: 'WORKFLOW_SOURCE_KEY_CONFLICT',
      message: 'WORKFLOW_SOURCE_KEY_CONFLICT',
      sourceKey,
      conflictingWorkflowId,
    });
  }
}
