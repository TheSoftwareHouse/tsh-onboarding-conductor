import { ConflictException } from '@nestjs/common';

export class UnknownWorkflowEvaluationException extends ConflictException {
  static readonly apiDescription =
    'The workflow produced no outcome the engine can apply; the onboarding is left ' + 'unchanged.';

  constructor() {
    super({
      code: 'UNKNOWN_WORKFLOW_EVALUATION',
      message: 'UNKNOWN_WORKFLOW_EVALUATION',
    });
  }
}
