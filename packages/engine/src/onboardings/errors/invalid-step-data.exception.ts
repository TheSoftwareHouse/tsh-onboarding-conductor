import { BadRequestException } from '@nestjs/common';

type FieldErrors = Readonly<Record<string, readonly string[]>>;

export class InvalidStepDataException extends BadRequestException {
  constructor(errors: FieldErrors) {
    super({
      code: 'INVALID_STEP_DATA',
      message: 'INVALID_STEP_DATA',
      errors,
    });
  }
}
