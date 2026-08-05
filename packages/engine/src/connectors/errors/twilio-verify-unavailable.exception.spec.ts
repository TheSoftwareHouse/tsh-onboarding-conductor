import { TwilioVerifyUnavailableException } from './twilio-verify-unavailable.exception';

describe('TwilioVerifyUnavailableException', () => {
  it('returns the safe response payload with HTTP 500', () => {
    const exception = new TwilioVerifyUnavailableException();

    expect(exception.getStatus()).toBe(500);
    expect(exception.getResponse()).toEqual({
      code: 'TWILIO_VERIFY_UNAVAILABLE',
      message: 'TWILIO_VERIFY_UNAVAILABLE',
    });
  });
});
