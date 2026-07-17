import { BadRequestException } from '@nestjs/common';

export class InvalidStepDataException extends BadRequestException {
  constructor() {
    super({
      code: 'INVALID_STEP_DATA',
      message: 'INVALID_STEP_DATA',
    });
  }
}
