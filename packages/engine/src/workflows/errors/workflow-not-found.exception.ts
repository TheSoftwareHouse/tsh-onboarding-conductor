import { NotFoundException } from '@nestjs/common';

export class WorkflowNotFoundException extends NotFoundException {
  static readonly apiDescription =
    'No published workflow has this id, or no revision of it carries the pinned version.';

  constructor() {
    super({
      code: 'WORKFLOW_NOT_FOUND',
      message: 'WORKFLOW_NOT_FOUND',
    });
  }
}
