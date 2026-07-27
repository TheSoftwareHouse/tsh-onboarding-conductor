import { ConflictException } from '@nestjs/common';

export class UnknownWorkflowEvaluationException extends ConflictException {
  constructor() {
    super({
      code: 'UNKNOWN_WORKFLOW_EVALUATION',
      message: 'UNKNOWN_WORKFLOW_EVALUATION',
    });
  }
}
