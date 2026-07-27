import { TshKyc1Connector } from './tsh-kyc.connector';
import { ConnectorExecutionResult } from '../ports/connector-execution-result';

describe('TshKyc1Connector', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('exposes the tsh_kyc_1 identity and resolves accepted after about five seconds', async () => {
    const connector = new TshKyc1Connector();
    const input = {
      declaration: {
        method: 'verify' as const,
        config: {},
      },
      execution: { onboardingId: 'onboarding-123', stepName: 'collect_email' },
      context: { email: 'person@example.com' },
      payload: { email: 'person@example.com' },
      payloadFieldSources: { email: 'email' },
    };

    expect(connector.name).toBe('tsh_kyc_1');
    expect(connector.type).toBe('mock_kyc_1');

    const pending = connector.verify(input);

    jest.advanceTimersByTime(4_999);
    await Promise.resolve();
    await expect(
      Promise.race([pending.then(() => 'resolved'), Promise.resolve('pending')]),
    ).resolves.toBe('pending');

    jest.advanceTimersByTime(1);
    await expect(pending).resolves.toEqual(ConnectorExecutionResult.accepted());
    expect(input).toEqual({
      declaration: {
        method: 'verify' as const,
        config: {},
      },
      execution: { onboardingId: 'onboarding-123', stepName: 'collect_email' },
      context: { email: 'person@example.com' },
      payload: { email: 'person@example.com' },
      payloadFieldSources: { email: 'email' },
    });
  });

  it('returns invalid for unsupported methods', async () => {
    const connector = new TshKyc1Connector();

    await expect(
      connector.verify({
        declaration: {
          method: 'verifyCode',
          config: {},
        },
        execution: { onboardingId: 'onboarding-123', stepName: 'collect_email' },
        context: { email: 'person@example.com' },
        payload: { code: '123456' },
        payloadFieldSources: { code: 'verificationCode' },
      }),
    ).resolves.toEqual(ConnectorExecutionResult.invalid());
  });
});
