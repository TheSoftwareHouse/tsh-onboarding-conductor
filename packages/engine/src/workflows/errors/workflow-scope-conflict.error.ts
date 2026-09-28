import type { WorkflowFile } from '../workflow-file-loader.service';
import type { WorkflowScope } from '../workflow-scope';

/**
 * What fixed the family's scope: a file loaded in the same boot, or — when only the stored
 * `workflows` row knows the family — that row alone.
 */
export type WorkflowScopeOwner = {
  readonly scope: WorkflowScope;
  readonly filePath?: string;
};

const FORK_EXAMPLE_PATH = 'workflows/users/eu-b2c-individual-kyc-eea-local.workflow.json';

/**
 * A file declares an `id` that belongs to a family in another scope. A family belongs to exactly
 * one scope — the directory whose file created it — so a `users/` file cannot add a revision to a
 * built-in flow: it forks the flow under an id of its own instead. Thrown from the file loader when
 * two scope directories declare one id, and from the startup publish when a file claims a family
 * the store already holds under another scope; either way the boot fails before anything is written.
 */
export class WorkflowScopeConflictError extends Error {
  readonly workflowId: string;
  readonly scope: WorkflowScope;
  readonly filePath: string;
  readonly ownerScope: WorkflowScope;
  readonly ownerFilePath: string | undefined;

  constructor(file: WorkflowFile, owner: WorkflowScopeOwner) {
    const ownership =
      owner.filePath === undefined
        ? `is stored under the "${owner.scope}" scope`
        : `is declared under the "${owner.scope}" scope by ${owner.filePath}`;

    super(
      `Workflow "${file.workflowId}" ${ownership}, but ${file.filePath} declares it under the ` +
        `"${file.scope}" scope. A workflow family belongs to exactly one scope. To adapt it, fork ` +
        'it: copy the document under an id of your own and rename its connector config.sourceKey ' +
        `values, as ${FORK_EXAMPLE_PATH} does.`,
    );
    this.name = 'WorkflowScopeConflictError';
    this.workflowId = file.workflowId;
    this.scope = file.scope;
    this.filePath = file.filePath;
    this.ownerScope = owner.scope;
    this.ownerFilePath = owner.filePath;
  }
}
