import type { WorkflowFile } from '../workflow-file-loader.service';

/**
 * A file declares an `id` and `version` the store already holds under a different definition. A
 * stored version is immutable — an onboarding pinned to it must keep resolving what it started on —
 * so the change has to ship as a new version. Thrown from the startup publish, where it fails the
 * boot the way a malformed document does.
 */
export class WorkflowVersionConflictError extends Error {
  readonly workflowId: string;
  readonly version: number;
  readonly filePath: string;

  constructor(file: WorkflowFile) {
    super(
      `Workflow "${file.workflowId}" version ${file.version} is already stored with a different ` +
        `definition; a stored version is immutable. Publish the change in ${file.filePath} as a ` +
        'new version, or on a development stack whose stored workflows are disposable throw them ' +
        'away with `pnpm stack:reset`.',
    );
    this.name = 'WorkflowVersionConflictError';
    this.workflowId = file.workflowId;
    this.version = file.version;
    this.filePath = file.filePath;
  }
}
