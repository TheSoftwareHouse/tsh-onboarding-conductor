import { MockKyc2Connector } from './mock-kyc-2.connector';
import { ConnectorExecutionResult } from '../../ports/connector-execution-result';
import { WorkflowSourceKind } from '../../../config/workflow-sources';

describe('MockKyc2Connector', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('exposes the mock_kyc_2 identity and resolves accepted after about five seconds', async () => {
    const connector = new MockKyc2Connector();
    const input = {
      declaration: {
        order: 1,
        config: {},
      },
      execution: {
        onboardingId: 'onboarding-123',
        stepName: 'collect_email',
        workflowSource: WorkflowSourceKind.FIXTURES,
      },
      context: { email: 'person@example.com', acceptedTerms: true },
      payload: { email: 'person@example.com', acceptedTerms: true },
      payloadFieldSources: { email: 'email', acceptedTerms: 'acceptedTerms' },
    };

    expect(connector.name).toBe('mock_kyc_2');
    expect(connector.type).toBe('mock_kyc_2');

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
      execution: {
        onboardingId: 'onboarding-123',
        stepName: 'collect_email',
        workflowSource: WorkflowSourceKind.FIXTURES,
      },
      context: { email: 'person@example.com', acceptedTerms: true },
      payload: { email: 'person@example.com', acceptedTerms: true },
      payloadFieldSources: { email: 'email', acceptedTerms: 'acceptedTerms' },
    });
  });

  it('ignores arbitrary connector config and still resolves accepted', async () => {
    const connector = new MockKyc2Connector();
    const input = {
      declaration: {
        order: 1,
        config: {
          operation: 'opaque-adapter-op',
          nested: { allowed: true },
          limits: [2, 4, 8],
        },
      },
      execution: {
        onboardingId: 'onboarding-123',
        stepName: 'collect_email',
        workflowSource: WorkflowSourceKind.FIXTURES,
      },
      context: { email: 'person@example.com', acceptedTerms: true },
      payload: { email: 'person@example.com', acceptedTerms: true },
      payloadFieldSources: { email: 'email', acceptedTerms: 'acceptedTerms' },
    };

    const pending = connector.execute(input);
    jest.advanceTimersByTime(5_000);

    await expect(pending).resolves.toEqual(ConnectorExecutionResult.accepted());
  });
});
