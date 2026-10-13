import { VeriffUnavailableException } from './veriff-unavailable.exception';

describe('VeriffUnavailableException', () => {
  it('returns the safe response payload with HTTP 500', () => {
    const exception = new VeriffUnavailableException();

    expect(exception.getStatus()).toBe(500);
    expect(exception.getResponse()).toEqual({
      code: 'VERIFF_UNAVAILABLE',
      message: 'VERIFF_UNAVAILABLE',
    });
  });
});
