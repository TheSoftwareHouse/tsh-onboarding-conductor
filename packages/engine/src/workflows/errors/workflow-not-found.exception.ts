import { NotFoundException } from '@nestjs/common';

export class WorkflowNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'WORKFLOW_NOT_FOUND',
      message: 'WORKFLOW_NOT_FOUND',
    });
  }
}
