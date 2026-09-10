import { BadRequestException } from '@nestjs/common';

type StepFieldErrors = Readonly<Record<string, readonly string[]>>;

export class InvalidStepDataException extends BadRequestException {
  static readonly apiDescription =
    'The submitted data violates the current step; `errors` maps each refused field to ' +
    'its reasons, and the onboarding stays where it was.';

  constructor(errors: StepFieldErrors) {
    super({
      code: 'INVALID_STEP_DATA',
      message: 'INVALID_STEP_DATA',
      errors,
    });
  }
}
