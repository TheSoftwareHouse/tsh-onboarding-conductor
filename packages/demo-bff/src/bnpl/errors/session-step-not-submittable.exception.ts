import { ConflictException } from '@nestjs/common';

/**
 * The session's current step is one this BFF records through its own route, never through
 * `submit`: the bank login (`bank-login`) and the credit check (`run`). Carries the step and the
 * route that owns it.
 */
export class SessionStepNotSubmittableException extends ConflictException {
  constructor(step: string, route: string) {
    super({
      code: 'SESSION_STEP_NOT_SUBMITTABLE',
      message: 'SESSION_STEP_NOT_SUBMITTABLE',
      step,
      route,
    });
  }
}
