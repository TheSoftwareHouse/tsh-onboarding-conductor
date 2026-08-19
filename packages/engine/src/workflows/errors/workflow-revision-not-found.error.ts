import { WorkflowInvalidError } from '@tsh/ddl-schema';

/**
 * A workflow that exists, pinned to a version it has no revision of.
 *
 * A subclass rather than a status of its own because who made the mistake depends on who pinned
 * the version: an onboarding replaying the revision it recorded means the store lost a row, which
 * is a fault, while a reader naming a version by hand has simply named one that is not there. It
 * stays a `WorkflowInvalidError` so the former keeps reporting as a fault, and is distinguishable
 * so the latter can be answered as the miss it is.
 */
export class WorkflowRevisionNotFoundError extends WorkflowInvalidError {
  constructor(
    readonly workflowId: string,
    readonly version: number,
  ) {
    super('INVALID_VALUE');
    this.name = 'WorkflowRevisionNotFoundError';
  }
}
