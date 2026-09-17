import { ConflictException } from '@nestjs/common';

export class OnboardingCompletedException extends ConflictException {
  static readonly apiDescription =
    'The onboarding is already approved or completed and accepts no further moves.';

  constructor() {
    super({
      code: 'ONBOARDING_COMPLETED',
      message: 'ONBOARDING_COMPLETED',
    });
  }
}
