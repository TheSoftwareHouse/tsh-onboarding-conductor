import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../ports/connector-execution-result';
import {
  MockEmailVerificationConnector,
  MockPhoneVerificationConnector,
} from './mock-verification.connector';

const RECIPIENT = '+15551234567';
const MAX_ATTEMPTS = 5;
const TTL_SECONDS = 600;

const challenge = (
  onboardingId: string,
  options: { async?: boolean; operation?: string; recipient?: unknown } = {},
) => ({
  declaration: {
    order: 1,
    config: { operation: options.operation ?? 'challenge' },
    async: options.async,
  },
  execution: { onboardingId, stepName: 'request_code' },
  context: {},
  payload: { recipient: options.recipient ?? RECIPIENT },
  payloadFieldSources: { recipient: 'phoneNumber' },
});

const verify = (
  onboardingId: string,
  code: unknown,
  options: { async?: boolean; operation?: string } = {},
) => ({
  declaration: {
    order: 1,
    config: { operation: options.operation ?? 'verify' },
    async: options.async,
  },
  execution: { onboardingId, stepName: 'verify_code' },
  context: {},
  payload: { recipient: RECIPIENT, code },
  payloadFieldSources: { recipient: 'phoneNumber', code: 'verificationCode' },
});

describe('MockPhoneVerificationConnector', () => {
  it('is registered under its own connector type and accepts callbacks', () => {
    const connector = new MockPhoneVerificationConnector();

    expect(connector.name).toBe('mock_phone_verification');
    expect(connector.type).toBe('mock_phone_verification');
    expect(connector.supportsAsyncCallback).toBe(true);
    expect(new MockEmailVerificationConnector().type).toBe('mock_email_verification');
  });

  describe('synchronous declarations', () => {
    it('accepts the code it issued for the challenge', async () => {
      const connector = new MockPhoneVerificationConnector();

      await expect(connector.execute(challenge('onboarding-1'))).resolves.toEqual(
        ConnectorExecutionResult.accepted(),
      );

      const code = connector.__peekCodeForTests('onboarding-1');
      expect(code).toMatch(/^\d{6}$/);

      await expect(connector.execute(verify('onboarding-1', code))).resolves.toEqual(
        ConnectorExecutionResult.accepted(),
      );
    });

    it('reads the operation wording of the providers it stands in for', async () => {
      const connector = new MockPhoneVerificationConnector();

      await expect(
        connector.execute(challenge('onboarding-1', { operation: 'startVerification' })),
      ).resolves.toEqual(ConnectorExecutionResult.accepted());

      const code = connector.__peekCodeForTests('onboarding-1');

      await expect(
        connector.execute(verify('onboarding-1', code, { operation: 'checkVerification' })),
      ).resolves.toEqual(ConnectorExecutionResult.accepted());
    });

    it('marks a wrong code as retryable invalid data', async () => {
      const connector = new MockPhoneVerificationConnector();
      await connector.execute(challenge('onboarding-1'));

      await expect(connector.execute(verify('onboarding-1', '000001'))).resolves.toEqual(
        ConnectorExecutionResult.invalidData(
          { verificationCode: ['INVALID'] },
          { [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true },
        ),
      );
    });

    it('rejects an exhausted, expired or missing challenge', async () => {
      const connector = new MockPhoneVerificationConnector();

      await expect(connector.execute(verify('missing', '123456'))).resolves.toEqual(
        ConnectorExecutionResult.rejected('CHALLENGE_NOT_FOUND'),
      );

      await connector.execute(challenge('exhausted'));
      for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
        await expect(connector.execute(verify('exhausted', '000001'))).resolves.toMatchObject({
          status: 'invalid-data',
        });
      }
      await expect(connector.execute(verify('exhausted', '000001'))).resolves.toEqual(
        ConnectorExecutionResult.rejected('ATTEMPTS_EXHAUSTED'),
      );

      connector.__setNowForTests(() => 1_000);
      await connector.execute(challenge('expired'));
      const expiredCode = connector.__peekCodeForTests('expired');
      connector.__setNowForTests(() => 1_000 + (TTL_SECONDS + 1) * 1_000);

      await expect(connector.execute(verify('expired', expiredCode))).resolves.toEqual(
        ConnectorExecutionResult.rejected('CHALLENGE_EXPIRED'),
      );
    });

    it('reports invalid input for an unknown operation, a missing recipient or a missing code', async () => {
      const connector = new MockPhoneVerificationConnector();

      await expect(
        connector.execute(challenge('onboarding-1', { operation: 'transmogrify' })),
      ).resolves.toEqual(ConnectorExecutionResult.invalid());
      await expect(
        connector.execute(challenge('onboarding-1', { recipient: '  ' })),
      ).resolves.toEqual(ConnectorExecutionResult.invalid());
      await expect(connector.execute(verify('onboarding-1', ''))).resolves.toEqual(
        ConnectorExecutionResult.invalid(),
      );
    });

    it('forgets every challenge on reset', async () => {
      const connector = new MockPhoneVerificationConnector();
      await connector.execute(challenge('onboarding-1'));

      connector.__resetForTests();

      expect(connector.__peekCodeForTests('onboarding-1')).toBeUndefined();
      expect(connector.__peekInitiationForTests('onboarding-1')).toBeUndefined();
    });
  });

  describe('asynchronous declarations', () => {
    it('answers a challenge with an initiation the engine can park', async () => {
      const connector = new MockPhoneVerificationConnector();

      await expect(connector.execute(challenge('onboarding-1', { async: true }))).resolves.toEqual(
        ConnectorExecutionResult.accepted(),
      );

      expect(connector.__peekInitiationForTests('onboarding-1')).toMatchObject({
        onboardingId: 'onboarding-1',
        connectorOrder: 1,
        detail: { operation: 'challenge' },
        providerReference: expect.any(String),
      });
    });

    it('defers a verification to the callback, then replays the submitted code', async () => {
      const connector = new MockPhoneVerificationConnector();
      await connector.execute(challenge('onboarding-1'));
      const code = connector.__peekCodeForTests('onboarding-1');

      await expect(
        connector.execute(verify('onboarding-1', code, { async: true })),
      ).resolves.toEqual(ConnectorExecutionResult.accepted());

      const initiation = connector.__peekInitiationForTests('onboarding-1');
      const callback = connector.__buildProviderCallbackForTests({
        providerReference: initiation?.providerReference,
        submittedData: { verificationCode: code },
      });

      await expect(connector.mapCallbackResult(callback)).resolves.toEqual({
        onboardingId: 'onboarding-1',
        submittedData: { verificationCode: code },
        resolvedConnector: { connectorOrder: 1 },
        result: ConnectorExecutionResult.accepted(),
      });
    });

    it('reports a wrong code from the callback as retryable invalid data', async () => {
      const connector = new MockPhoneVerificationConnector();
      await connector.execute(challenge('onboarding-1'));
      await connector.execute(verify('onboarding-1', '000001', { async: true }));

      const initiation = connector.__peekInitiationForTests('onboarding-1');
      const mapped = await connector.mapCallbackResult(
        connector.__buildProviderCallbackForTests({
          providerReference: initiation?.providerReference,
        }),
      );

      expect(mapped.result).toEqual(
        ConnectorExecutionResult.invalidData(
          { verificationCode: ['INVALID'] },
          { [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true },
        ),
      );
    });

    it('lets the provider report a terminal rejection with its reason', async () => {
      const connector = new MockPhoneVerificationConnector();
      await connector.execute(challenge('onboarding-1'));
      await connector.execute(verify('onboarding-1', '000001', { async: true }));

      const initiation = connector.__peekInitiationForTests('onboarding-1');
      const mapped = await connector.mapCallbackResult(
        connector.__buildProviderCallbackForTests({
          providerReference: initiation?.providerReference,
          status: 'rejected',
          reason: 'ATTEMPTS_EXHAUSTED',
        }),
      );

      expect(mapped.result).toEqual(ConnectorExecutionResult.rejected('ATTEMPTS_EXHAUSTED'));
    });

    it('refuses a callback that is unknown, empty or carries engine correlation fields', async () => {
      const connector = new MockPhoneVerificationConnector();
      const encode = (payload: unknown) => ({
        rawBody: new TextEncoder().encode(JSON.stringify(payload)),
        headers: {},
      });

      await expect(
        connector.mapCallbackResult(encode({ providerReference: 'nope' })),
      ).rejects.toThrow('Unknown provider reference');
      await expect(
        connector.mapCallbackResult({ rawBody: new Uint8Array(), headers: {} }),
      ).rejects.toThrow('Callback body is required');
      await expect(
        connector.mapCallbackResult(encode({ providerReference: 'x', onboardingId: 'leak' })),
      ).rejects.toThrow('forbidden correlation fields');
    });
  });
});
