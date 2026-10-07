import { parseConnectorMocks } from './connector-mocks.config';

describe('parseConnectorMocks', () => {
  it('treats missing, empty and blank values as no substitutions', () => {
    expect(parseConnectorMocks(undefined).size).toBe(0);
    expect(parseConnectorMocks('').size).toBe(0);
    expect(parseConnectorMocks('   ').size).toBe(0);
  });

  it('parses comma-separated pairs, trimming each side', () => {
    expect([
      ...parseConnectorMocks(' otp : mock_otp , sendgrid_email:mock_email_delivery '),
    ]).toEqual([
      ['otp', 'mock_otp'],
      ['sendgrid_email', 'mock_email_delivery'],
    ]);
  });

  it('keeps the last mock named for a connector', () => {
    expect(parseConnectorMocks('otp:mock_otp,otp:mock_email_delivery').get('otp')).toBe(
      'mock_email_delivery',
    );
  });

  it('rejects anything that is not a pair of lowercase connector types', () => {
    for (const raw of [
      'otp',
      'otp:',
      ':mock_otp',
      'Otp_Verify:mock_otp',
      'otp-verify:mock_otp',
      'otp:mock:extra',
    ]) {
      expect(() => parseConnectorMocks(raw)).toThrow('CONNECTOR_MOCKS entries must be');
    }
  });

  it('rejects a connector standing in for itself', () => {
    expect(() => parseConnectorMocks('otp:otp')).toThrow('cannot replace type=otp with itself');
  });
});
