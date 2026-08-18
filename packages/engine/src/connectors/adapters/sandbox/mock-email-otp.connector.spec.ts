import { MockSmsOtpConnector } from './mock-sms-otp.connector';
import { MockEmailOtpConnector } from './mock-email-otp.connector';
import { WorkflowSourceKind } from '../../../config/workflow-sources';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../ports/connector-execution-result';

const createGenerationInput = (onboardingId: string, recipient = 'person@example.com') => ({
  declaration: {
    order: 1,
    config: { operation: 'generateCode', codeLength: 6, ttlSeconds: 120 },
  },
  execution: {
    onboardingId,
    stepName: 'request_code',
    workflowSource: WorkflowSourceKind.FIXTURES,
  },
  context: { email: recipient },
  payload: { recipient },
  payloadFieldSources: { recipient: 'email' },
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

describe('MockEmailOtpConnector', () => {
  it('rejects malformed payload/config input with generic invalid outcome', async () => {
    const connector = new MockEmailOtpConnector();

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

  it('generates deterministic challenges, keeps OTP state local, and cleans up on success', async () => {
    const connector = new MockEmailOtpConnector();
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

    const outcome = await connector.execute(createGenerationInput('onboarding-2'));
    expect(outcome.isAccepted()).toBe(true);
    expect(outcome.metadata).toBeUndefined();
  });

  it('returns invalid-data for non-final mismatch and rejected after attempt exhaustion', async () => {
    const connector = new MockEmailOtpConnector();
    connector.__resetForTests();

    const onboardingId = 'onboarding-1';
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

  it('rejects expired challenges and keeps onboarding challenges isolated', async () => {
    const connector = new MockEmailOtpConnector();
    connector.__resetForTests();

    connector.__setNowForTests(() => 1_000);
    await connector.execute(createGenerationInput('onboarding-1'));
    await connector.execute(createGenerationInput('onboarding-2'));

    connector.__setNowForTests(() => 1_000 + 121_000);

    await expect(
      connector.execute(createVerificationInput('onboarding-1', '999999')),
    ).resolves.toEqual(ConnectorExecutionResult.rejected('CHALLENGE_EXPIRED'));
    expect(connector.__peekCodeForTests('onboarding-1')).toBeUndefined();
    expect(connector.__peekCodeForTests('onboarding-2')).toMatch(/^\d{6}$/);
  });

  it('isolates challenge state by connector type for the same onboarding id', async () => {
    const emailConnector = new MockEmailOtpConnector();
    const smsConnector = new MockSmsOtpConnector();
    emailConnector.__resetForTests();
    smsConnector.__resetForTests();

    await emailConnector.execute(createGenerationInput('onboarding-shared'));

    await expect(
      smsConnector.execute(createVerificationInput('onboarding-shared', '123456')),
    ).resolves.toEqual(ConnectorExecutionResult.rejected('CHALLENGE_NOT_FOUND'));
    expect(emailConnector.__peekCodeForTests('onboarding-shared')).toMatch(/^\d{6}$/);
  });

  it('rejects missing challenges with CHALLENGE_NOT_FOUND', async () => {
    const connector = new MockEmailOtpConnector();
    connector.__resetForTests();

    await expect(
      connector.execute(createVerificationInput('missing-onboarding', '999999')),
    ).resolves.toEqual(ConnectorExecutionResult.rejected('CHALLENGE_NOT_FOUND'));
  });
});
