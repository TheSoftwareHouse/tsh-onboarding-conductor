import { AlgoanUnavailableException } from './algoan-unavailable.exception';

describe('AlgoanUnavailableException', () => {
  it('returns the safe response payload with HTTP 503', () => {
    const exception = new AlgoanUnavailableException();

    expect(exception.getStatus()).toBe(503);
    expect(exception.getResponse()).toEqual({
      code: 'ALGOAN_UNAVAILABLE',
      message: 'ALGOAN_UNAVAILABLE',
    });
  });
});
