import { parseConnectorMocks } from './connector-mocks.config';

describe('parseConnectorMocks', () => {
  it('treats missing, empty and blank values as no substitutions', () => {
    expect(parseConnectorMocks(undefined).size).toBe(0);
    expect(parseConnectorMocks('').size).toBe(0);
    expect(parseConnectorMocks('   ').size).toBe(0);
  });

  it('parses comma-separated pairs, trimming each side', () => {
    expect([
      ...parseConnectorMocks(
        ' twilio_verify : mock_phone_verification , sendgrid_email:mock_email_delivery ',
      ),
    ]).toEqual([
      ['twilio_verify', 'mock_phone_verification'],
      ['sendgrid_email', 'mock_email_delivery'],
    ]);
  });

  it('keeps the last mock named for a connector', () => {
    expect(
      parseConnectorMocks(
        'twilio_verify:mock_phone_verification,twilio_verify:mock_email_verification',
      ).get('twilio_verify'),
    ).toBe('mock_email_verification');
  });

  it('rejects anything that is not a pair of lowercase connector types', () => {
    for (const raw of [
      'twilio_verify',
      'twilio_verify:',
      ':mock_phone_verification',
      'Twilio_Verify:mock_phone_verification',
      'twilio-verify:mock_phone_verification',
      'twilio_verify:mock:extra',
    ]) {
      expect(() => parseConnectorMocks(raw)).toThrow('CONNECTOR_MOCKS entries must be');
    }
  });

  it('rejects a connector standing in for itself', () => {
    expect(() => parseConnectorMocks('twilio_verify:twilio_verify')).toThrow(
      'cannot replace type=twilio_verify with itself',
    );
  });
});
