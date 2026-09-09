import { BadRequestException } from '@nestjs/common';
import type { WorkflowInvalidPath, WorkflowInvalidReason } from '@tsh/ddl-schema';

/**
 * A submitted definition the DDL refused. Carries the reason and — when the DDL could say — the
 * path into the document, which is what a builder highlights. The message stays the stable code,
 * as it does on the domain error this maps.
 */
export class WorkflowInvalidException extends BadRequestException {
  constructor(reason: WorkflowInvalidReason, path?: WorkflowInvalidPath) {
    super({
      code: 'WORKFLOW_INVALID',
      message: 'WORKFLOW_INVALID',
      reason,
      ...(path === undefined ? {} : { path }),
    });
  }
}
