import { NotFoundException } from '@nestjs/common';

export class OnboardingNotFoundException extends NotFoundException {
  static readonly apiDescription = 'No onboarding has this id.';

  constructor() {
    super({
      code: 'ONBOARDING_NOT_FOUND',
      message: 'ONBOARDING_NOT_FOUND',
    });
  }
}
