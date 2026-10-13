import { ConflictException } from '@nestjs/common';

/** An onboarding references the draft, so it can be neither replaced nor deleted. */
export class WorkflowDraftInUseException extends ConflictException {
  static readonly apiDescription =
    'An onboarding references this draft; carries `workflowId` and `version`.';

  constructor(workflowId = '', version = 0) {
    super({
      code: 'WORKFLOW_DRAFT_IN_USE',
      message: 'WORKFLOW_DRAFT_IN_USE',
      workflowId,
      version,
    });
  }
}
