import { ConflictException } from '@nestjs/common';

/** The run was requested before the onboarding reached the step that takes the bank data. */
export class StepNotReadyException extends ConflictException {
  constructor() {
    super({ code: 'STEP_NOT_READY', message: 'STEP_NOT_READY' });
  }
}
