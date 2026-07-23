import { ConflictException } from '@nestjs/common';

export class ManualTransitionNotAvailableException extends ConflictException {
  constructor() {
    super({
      code: 'MANUAL_TRANSITION_NOT_AVAILABLE',
      message: 'MANUAL_TRANSITION_NOT_AVAILABLE',
    });
  }
}
