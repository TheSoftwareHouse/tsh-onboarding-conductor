import { InvalidStepDataException } from '../errors/invalid-step-data.exception';
import { DynamicSubmitBodyPipe } from './dynamic-submit-body.pipe';

describe('DynamicSubmitBodyPipe', () => {
  const pipe = new DynamicSubmitBodyPipe();

  it('throws InvalidStepDataException for non-object payloads', () => {
    expect(() => pipe.transform(null)).toThrow(InvalidStepDataException);
    expect(() => pipe.transform('invalid')).toThrow(InvalidStepDataException);
    expect(() => pipe.transform([])).toThrow(InvalidStepDataException);
  });

  it('passes through plain object payloads', () => {
    const value = { email: 'user@example.com' };

    expect(pipe.transform(value)).toEqual(value);
  });
});
