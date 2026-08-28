/**
 * Two workflow documents declare a connector `config.sourceKey` that is meant to be unique per
 * document — the same key reused within one document (across steps or connectors) is legal and
 * does not trigger this. Thrown from the startup sweep in `WorkflowRegistryService.onModuleInit`,
 * the only place holding every stored workflow at once.
 */
export class DuplicateWorkflowSourceKeyError extends Error {
  constructor(
    public readonly firstWorkflowId: string,
    public readonly secondWorkflowId: string,
    public readonly sourceKey: string,
  ) {
    super(
      `Workflow documents "${firstWorkflowId}" and "${secondWorkflowId}" both declare connector config.sourceKey "${sourceKey}"; sourceKey must be unique per workflow document.`,
    );
    this.name = 'DuplicateWorkflowSourceKeyError';
  }
}
