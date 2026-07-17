import { ConflictException } from '@nestjs/common';

export class OnboardingCompletedException extends ConflictException {
  constructor() {
    super({
      code: 'ONBOARDING_COMPLETED',
      message: 'ONBOARDING_COMPLETED',
    });
  }
}
