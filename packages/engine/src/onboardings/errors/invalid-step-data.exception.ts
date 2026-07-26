import { BadRequestException } from '@nestjs/common';

type StepFieldErrors = Readonly<Record<string, readonly string[]>>;

export class InvalidStepDataException extends BadRequestException {
  constructor(errors: StepFieldErrors) {
    super({
      code: 'INVALID_STEP_DATA',
      message: 'INVALID_STEP_DATA',
      errors,
    });
  }
}
