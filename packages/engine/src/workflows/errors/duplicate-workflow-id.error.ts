import type { WorkflowSourceKind } from '../workflow-source';

export class DuplicateWorkflowIdError extends Error {
  constructor(
    public readonly workflowId: string,
    public readonly existingSource: WorkflowSourceKind,
    public readonly conflictingSource: WorkflowSourceKind,
  ) {
    super(
      `Duplicate workflow id=${workflowId} declared by the ${existingSource} and ${conflictingSource} sources`,
    );
    this.name = 'DuplicateWorkflowIdError';
  }
}
