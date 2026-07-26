import { DynamicSubmitBodyPipe } from './dynamic-submit-body.pipe';

describe('DynamicSubmitBodyPipe', () => {
  const pipe = new DynamicSubmitBodyPipe();

  it('passes through null, scalar, array, and object payloads unchanged', () => {
    for (const payload of [null, 'invalid', 123, true, ['item'], { email: 'user@example.com' }]) {
      expect(pipe.transform(payload)).toBe(payload);
    }
  });
});
