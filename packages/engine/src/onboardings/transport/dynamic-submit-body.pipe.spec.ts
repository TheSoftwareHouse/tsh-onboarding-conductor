import { InvalidStepDataException } from '../errors/invalid-step-data.exception';
import { DynamicSubmitBodyPipe } from './dynamic-submit-body.pipe';

describe('DynamicSubmitBodyPipe', () => {
  const pipe = new DynamicSubmitBodyPipe();

  it('throws InvalidStepDataException for non-object payloads', () => {
    for (const payload of [null, 'invalid', []]) {
      try {
        pipe.transform(payload);
        throw new Error('Expected InvalidStepDataException');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(InvalidStepDataException);
        if (!(error instanceof InvalidStepDataException)) {
          throw error;
        }

        expect(error.getResponse()).toEqual({
          code: 'INVALID_STEP_DATA',
          message: 'INVALID_STEP_DATA',
          errors: {},
        });
      }
    }
  });

  it('passes through plain object payloads', () => {
    const value = { email: 'user@example.com' };

    expect(pipe.transform(value)).toEqual(value);
  });
});
