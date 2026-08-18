import { MockSmsOtpConnector } from './mock-sms-otp.connector';
import { WorkflowSourceKind } from '../../../config/workflow-sources';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../ports/connector-execution-result';

const createGenerationInput = (onboardingId: string, recipient = '+15551234567') => ({
  declaration: {
    order: 1,
    config: { operation: 'generateCode', codeLength: 6, ttlSeconds: 120 },
  },
  execution: {
    onboardingId,
    stepName: 'request_code',
    workflowSource: WorkflowSourceKind.FIXTURES,
  },
  context: { phoneNumber: recipient },
  payload: { recipient },
  payloadFieldSources: { recipient: 'phoneNumber' },
});

const createVerificationInput = (onboardingId: string, code: unknown) => ({
  declaration: {
    order: 1,
    config: { operation: 'verifyCode', maxAttempts: 3 },
  },
  execution: { onboardingId, stepName: 'verify_code', workflowSource: WorkflowSourceKind.FIXTURES },
  context: {},
  payload: { code },
  payloadFieldSources: { code: 'verificationCode' },
});

describe('MockSmsOtpConnector', () => {
  it('rejects malformed payload/config input with generic invalid outcome', async () => {
    const connector = new MockSmsOtpConnector();

    await expect(
      connector.execute({
        ...createGenerationInput('onboarding-1', ''),
        declaration: {
          order: 1,
          config: { operation: 'generateCode', codeLength: 0, ttlSeconds: 0 },
        },
      }),
    ).resolves.toEqual(ConnectorExecutionResult.invalid());

    await expect(
      connector.execute({
        ...createVerificationInput('onboarding-1', ''),
        declaration: {
          order: 1,
          config: { operation: 'verifyCode', maxAttempts: 0 },
        },
      }),
    ).resolves.toEqual(ConnectorExecutionResult.invalid());

    await expect(
      connector.execute({
        ...createGenerationInput('onboarding-1'),
        declaration: {
          order: 1,
          config: { operation: 'adapter-private-unknown' },
        },
      }),
    ).resolves.toEqual(ConnectorExecutionResult.invalid());
  });

  it('generates and verifies deterministic codes without exposing OTP details', async () => {
    const connector = new MockSmsOtpConnector();
    connector.__resetForTests();

    const onboardingId = 'onboarding-1';
    await expect(connector.execute(createGenerationInput(onboardingId))).resolves.toEqual(
      ConnectorExecutionResult.accepted(),
    );

    const generatedCode = connector.__peekCodeForTests(onboardingId);
    expect(generatedCode).toMatch(/^\d{6}$/);

    await expect(
      connector.execute(createVerificationInput(onboardingId, generatedCode)),
    ).resolves.toEqual(ConnectorExecutionResult.accepted());
    expect(connector.__peekCodeForTests(onboardingId)).toBeUndefined();

    const acceptedOutcome = await connector.execute(createGenerationInput('onboarding-plain'));
    expect(acceptedOutcome.isAccepted()).toBe(true);
    expect(acceptedOutcome.metadata).toBeUndefined();
  });

  it('returns invalid-data for non-final mismatch and rejects after attempts are exhausted', async () => {
    const connector = new MockSmsOtpConnector();
    connector.__resetForTests();

    const onboardingId = 'onboarding-2';
    await connector.execute(createGenerationInput(onboardingId));

    await expect(
      connector.execute(createVerificationInput(onboardingId, '000000')),
    ).resolves.toEqual(
      ConnectorExecutionResult.invalidData(
        { verificationCode: ['INVALID'] },
        {
          [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
        },
      ),
    );
    await expect(
      connector.execute(createVerificationInput(onboardingId, '111111')),
    ).resolves.toEqual(
      ConnectorExecutionResult.invalidData(
        { verificationCode: ['INVALID'] },
        {
          [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
        },
      ),
    );
    await expect(
      connector.execute(createVerificationInput(onboardingId, '222222')),
    ).resolves.toEqual(ConnectorExecutionResult.rejected('ATTEMPTS_EXHAUSTED'));

    const rejectedOutcome = await connector.execute(
      createVerificationInput('missing-onboarding', '999999'),
    );
    expect(rejectedOutcome.isRejected()).toBe(true);
    expect(rejectedOutcome.metadata).toBeUndefined();

    expect(connector.__peekCodeForTests(onboardingId)).toBeUndefined();
  });

  it('rejects expired challenges with CHALLENGE_EXPIRED', async () => {
    const connector = new MockSmsOtpConnector();
    connector.__resetForTests();

    connector.__setNowForTests(() => 5_000);
    await connector.execute(createGenerationInput('onboarding-3'));

    connector.__setNowForTests(() => 5_000 + 121_000);
    await expect(
      connector.execute(createVerificationInput('onboarding-3', '999999')),
    ).resolves.toEqual(ConnectorExecutionResult.rejected('CHALLENGE_EXPIRED'));
    expect(connector.__peekCodeForTests('onboarding-3')).toBeUndefined();
  });

  it('rejects missing challenges with CHALLENGE_NOT_FOUND', async () => {
    const connector = new MockSmsOtpConnector();
    connector.__resetForTests();

    await expect(
      connector.execute(createVerificationInput('missing-onboarding', '999999')),
    ).resolves.toEqual(ConnectorExecutionResult.rejected('CHALLENGE_NOT_FOUND'));
  });
});
