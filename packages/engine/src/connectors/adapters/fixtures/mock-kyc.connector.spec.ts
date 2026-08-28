import { MockKyc1Connector, MockKyc2Connector } from './mock-kyc.connector';
import { ConnectorExecutionResult } from '../../ports/connector-execution-result';
import type { ConnectorExecutionInput } from '../../ports/connector-adapter.port';

const buildInput = (): ConnectorExecutionInput => ({
  declaration: {
    order: 1,
    config: {},
  },
  execution: { onboardingId: 'onboarding-123', stepName: 'collect_email' },
  context: { email: 'person@example.com', acceptedTerms: true },
  payload: { email: 'person@example.com', acceptedTerms: true },
  payloadFieldSources: { email: 'email', acceptedTerms: 'acceptedTerms' },
});

describe.each([
  ['MockKyc1Connector', MockKyc1Connector, 'mock_kyc_1'],
  ['MockKyc2Connector', MockKyc2Connector, 'mock_kyc_2'],
] as const)('%s', (_label, Connector, connectorId) => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it(`exposes the ${connectorId} identity and resolves accepted after about five seconds`, async () => {
    const connector = new Connector();
    const input = buildInput();

    expect(connector.name).toBe(connectorId);
    expect(connector.id).toBe(connectorId);
    expect(connector.type).toBe('kyc');

    const pending = connector.execute(input);

    jest.advanceTimersByTime(4_999);
    await Promise.resolve();
    await expect(
      Promise.race([pending.then(() => 'resolved'), Promise.resolve('pending')]),
    ).resolves.toBe('pending');

    jest.advanceTimersByTime(1);
    await expect(pending).resolves.toEqual(ConnectorExecutionResult.accepted());
    expect(input).toEqual(buildInput());
  });

  it('ignores arbitrary connector config and still resolves accepted', async () => {
    const connector = new Connector();
    const input: ConnectorExecutionInput = {
      ...buildInput(),
      declaration: {
        order: 1,
        config: {
          operation: 'unknown-private-op',
          nested: { flag: true },
          limits: [2, 4, 8],
        },
      },
    };

    const pending = connector.execute(input);
    jest.advanceTimersByTime(5_000);

    await expect(pending).resolves.toEqual(ConnectorExecutionResult.accepted());
  });
});
