import { HttpStatus } from '@nestjs/common';
import { InvalidStepDataException } from './invalid-step-data.exception';

describe('InvalidStepDataException', () => {
  it('exposes the stable 400 INVALID_STEP_DATA contract', () => {
    const errors = {
      verificationCode: ['INVALID'] as const,
      firstName: ['REQUIRED'] as const,
    };

    const exception = new InvalidStepDataException(errors);

    expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(exception.getResponse()).toEqual({
      code: 'INVALID_STEP_DATA',
      message: 'INVALID_STEP_DATA',
      errors,
    });
  });
});
