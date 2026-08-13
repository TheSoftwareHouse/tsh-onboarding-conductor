export const WORKFLOW_INVALID = 'WORKFLOW_INVALID' as const;

export type WorkflowInvalidReason =
  | 'INVALID_SHAPE'
  | 'UNKNOWN_PROPERTY'
  | 'INVALID_VALUE'
  | 'DUPLICATE_STEP_NAME'
  | 'DUPLICATE_FIELD_NAME'
  | 'DUPLICATE_TRANSITION'
  | 'INVALID_TRANSITIONS'
  | 'UNKNOWN_TARGET'
  | 'INVALID_TERMINAL_STEP';

export class WorkflowInvalidError extends Error {
  readonly code = WORKFLOW_INVALID;

  constructor(readonly reason: WorkflowInvalidReason) {
    super(WORKFLOW_INVALID);
    this.name = 'WorkflowInvalidError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const failWorkflow = (reason: WorkflowInvalidReason): never => {
  throw new WorkflowInvalidError(reason);
};
