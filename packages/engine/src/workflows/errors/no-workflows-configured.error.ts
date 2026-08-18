export class NoWorkflowsConfiguredError extends Error {
  constructor() {
    super(
      'No workflows were loaded. Configure at least one of BUILTIN_WORKFLOWS_DIR, WORKFLOWS_DIR or FIXTURE_WORKFLOWS_DIR with workflow definitions.',
    );
    this.name = 'NoWorkflowsConfiguredError';
  }
}
