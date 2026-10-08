import { ConflictException } from '@nestjs/common';

export class OnboardingNotAwaitingConnectorException extends ConflictException {
  static readonly apiDescription =
    'The onboarding is not parked on a connector, so there is no provider attempt to read back.';

  constructor() {
    super({
      code: 'ONBOARDING_NOT_AWAITING_CONNECTOR',
      message: 'ONBOARDING_NOT_AWAITING_CONNECTOR',
    });
  }
}
