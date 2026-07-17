import { NotFoundException } from '@nestjs/common';

export class OnboardingNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'ONBOARDING_NOT_FOUND',
      message: 'ONBOARDING_NOT_FOUND',
    });
  }
}
