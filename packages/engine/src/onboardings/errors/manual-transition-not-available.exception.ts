import { ConflictException } from '@nestjs/common';

export class ManualTransitionNotAvailableException extends ConflictException {
  static readonly apiDescription =
    'The current step declares no transition for this manual trigger.';

  constructor() {
    super({
      code: 'MANUAL_TRANSITION_NOT_AVAILABLE',
      message: 'MANUAL_TRANSITION_NOT_AVAILABLE',
    });
  }
}
