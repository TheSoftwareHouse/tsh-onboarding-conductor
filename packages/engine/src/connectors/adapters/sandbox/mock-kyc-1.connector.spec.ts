import { MockKyc1Connector } from './mock-kyc-1.connector';
import { ConnectorExecutionResult } from '../../ports/connector-execution-result';

describe('MockKyc1Connector', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('exposes the mock_kyc_1 identity and resolves accepted after about five seconds', async () => {
    const connector = new MockKyc1Connector();
    const input = {
      declaration: {
        order: 1,
        config: {},
      },
      execution: { onboardingId: 'onboarding-123', stepName: 'collect_email' },
      context: { email: 'person@example.com' },
      payload: { email: 'person@example.com' },
      payloadFieldSources: { email: 'email' },
    };

    expect(connector.name).toBe('mock_kyc_1');
    expect(connector.type).toBe('mock_kyc_1');

    const pending = connector.execute(input);

    jest.advanceTimersByTime(4_999);
    await Promise.resolve();
    await expect(
      Promise.race([pending.then(() => 'resolved'), Promise.resolve('pending')]),
    ).resolves.toBe('pending');

    jest.advanceTimersByTime(1);
    await expect(pending).resolves.toEqual(ConnectorExecutionResult.accepted());
    expect(input).toEqual({
      declaration: {
        order: 1,
        config: {},
      },
      execution: { onboardingId: 'onboarding-123', stepName: 'collect_email' },
      context: { email: 'person@example.com' },
      payload: { email: 'person@example.com' },
      payloadFieldSources: { email: 'email' },
    });
  });

  it('ignores arbitrary connector config and still resolves accepted', async () => {
    const connector = new MockKyc1Connector();
    const input = {
      declaration: {
        order: 1,
        config: {
          operation: 'unknown-private-op',
          nested: { flag: true },
          arr: [1, 'x', false],
        },
      },
      execution: { onboardingId: 'onboarding-123', stepName: 'collect_email' },
      context: { email: 'person@example.com' },
      payload: { email: 'person@example.com' },
      payloadFieldSources: { email: 'email' },
    };

    const pending = connector.execute(input);
    jest.advanceTimersByTime(5_000);

    await expect(pending).resolves.toEqual(ConnectorExecutionResult.accepted());
  });
});
