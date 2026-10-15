import { ConflictException } from '@nestjs/common';

/** The onboarding no longer accepts this move (completed, or no manual transition is available). */
export class SessionConflictException extends ConflictException {
  constructor() {
    super({ code: 'SESSION_CONFLICT', message: 'SESSION_CONFLICT' });
  }
}
