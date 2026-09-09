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

/**
 * Where in the document the defect is, as a dotted path such as `nodes[3].config.documents[1]`.
 * Carried as its own property, never folded into `message`: the message is the stable code a
 * caller may log or compare, and a path names things from the document, which the message must
 * not leak.
 */
export type WorkflowInvalidPath = string;

export class WorkflowInvalidError extends Error {
  readonly code = WORKFLOW_INVALID;

  constructor(
    readonly reason: WorkflowInvalidReason,
    readonly path?: WorkflowInvalidPath,
  ) {
    super(WORKFLOW_INVALID);
    this.name = 'WorkflowInvalidError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const failWorkflow = (reason: WorkflowInvalidReason, path?: WorkflowInvalidPath): never => {
  throw new WorkflowInvalidError(reason, path);
};

/**
 * Runs `work` and, if it fails without saying where, says where. A failure that already carries a
 * path came from something nested deeper and knows better, so it is left alone — the innermost
 * location wins.
 */
export const locateWorkflowFailure = <TResult>(
  path: WorkflowInvalidPath,
  work: () => TResult,
): TResult => {
  try {
    return work();
  } catch (error) {
    if (error instanceof WorkflowInvalidError && error.path === undefined) {
      throw new WorkflowInvalidError(error.reason, path);
    }

    throw error;
  }
};

/** `/nodes/0/config/connector` → `nodes[0].config.connector`, the form a reader expects. */
export const toWorkflowInvalidPath = (instancePath: string): WorkflowInvalidPath | undefined => {
  if (instancePath === '') {
    return undefined;
  }

  return instancePath
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((segment, index) => {
      if (/^\d+$/.test(segment)) {
        return `[${segment}]`;
      }

      return index === 0 ? segment : `.${segment}`;
    })
    .join('');
};
