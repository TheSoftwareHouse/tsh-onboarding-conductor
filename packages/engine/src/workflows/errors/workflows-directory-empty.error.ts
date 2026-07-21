export class WorkflowsDirectoryEmptyError extends Error {
  constructor(public readonly workflowsDir: string) {
    super(`Workflows directory is empty or has no direct JSON files: ${workflowsDir}`);
    this.name = 'WorkflowsDirectoryEmptyError';
  }
}
