import { NotFoundException } from '@nestjs/common';

export class WorkflowStepNotFoundException extends NotFoundException {
  static readonly apiDescription =
    'No version the write targets declares a step with this name; carries `stepName`.';

  constructor(stepName: string) {
    super({
      code: 'WORKFLOW_STEP_NOT_FOUND',
      message: 'WORKFLOW_STEP_NOT_FOUND',
      stepName,
    });
  }
}
