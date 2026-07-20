export class WorkflowsDirectoryReadError extends Error {
  constructor(
    public readonly workflowsDir: string,
    cause?: Error,
  ) {
    const errorMessage = cause ? `: ${cause.message}` : '';
    super(`Cannot read workflows directory: ${workflowsDir}${errorMessage}`);
    this.name = 'WorkflowsDirectoryReadError';
  }
}
