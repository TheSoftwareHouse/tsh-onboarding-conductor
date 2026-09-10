import { GoneException } from '@nestjs/common';

/**
 * A revision that exists but was discontinued. Distinct from `WORKFLOW_NOT_FOUND`
 * on purpose: the caller pinned a real revision, and the reason it cannot be used
 * is permanent rather than a lookup mistake, so it must not be retried.
 */
export class WorkflowRetiredException extends GoneException {
  static readonly apiDescription =
    'The pinned revision is retired and can no longer be read or run.';

  constructor() {
    super({
      code: 'WORKFLOW_RETIRED',
      message: 'WORKFLOW_RETIRED',
    });
  }
}
