import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import type { ConnectorAdapter, ConnectorAdapterCollection } from './ports/connector-adapter.port';
import { ConnectorExecutionResult } from './ports/connector-execution-result';
import { ConnectorPayloadFieldNotFoundError } from './errors/connector-payload-field-not-found.error';
import { WorkflowConnectorExecutorService } from './workflow-connector-executor.service';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

const createConnector = (name: string, type: string): ConnectorAdapter & { verify: jest.Mock } => ({
  name,
  type,
  verify: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
});

const declaration = (
  overrides: Partial<NormalizedWorkflowConnectorDeclaration> &
    Pick<NormalizedWorkflowConnectorDeclaration, 'name' | 'type' | 'order' | 'fieldMapping'>,
): NormalizedWorkflowConnectorDeclaration => ({
  method: 'verify',
  canReject: false,
  config: {},
  ...overrides,
});

describe('WorkflowConnectorExecutorService', () => {
  it('forwards declaration method/config, mapped payload, copied context, and execution identity', async () => {
    const connector = createConnector('adapter_one', 'mock_kyc_1');
    const service = new WorkflowConnectorExecutorService([connector] as ConnectorAdapterCollection);
    const context = { email: 'person@example.com', acceptedTerms: true };
    const execution = { onboardingId: 'onboarding-123', stepName: 'collect_email' };

    await expect(
      service.execute(
        [
          declaration({
            name: 'declaration_one',
            type: 'mock_kyc_1',
            order: 1,
            method: 'verifyCode',
            config: { maxAttempts: 3 },
            fieldMapping: { code: 'email' },
          }),
        ],
        context,
        execution,
      ),
    ).resolves.toEqual(ConnectorExecutionResult.accepted());

    expect(connector.verify).toHaveBeenCalledWith({
      declaration: {
        method: 'verifyCode',
        config: { maxAttempts: 3 },
      },
      execution,
      context: { email: 'person@example.com', acceptedTerms: true },
      payload: { code: 'person@example.com' },
      payloadFieldSources: { code: 'email' },
    });

    const input = connector.verify.mock.calls[0][0] as {
      declaration: { method: string; config: Record<string, unknown> };
      execution: { onboardingId: string; stepName: string };
      context: Record<string, unknown>;
      payload: Record<string, unknown>;
      payloadFieldSources: Record<string, string>;
    };

    expect(input.execution).not.toBe(execution);
    expect(input.context).not.toBe(context);
    expect(input.declaration.config).not.toBe(
      (
        declaration({
          name: 'declaration_one',
          type: 'mock_kyc_1',
          order: 1,
          method: 'verifyCode',
          config: { maxAttempts: 3 },
          fieldMapping: { code: 'email' },
        }) as NormalizedWorkflowConnectorDeclaration
      ).config,
    );
  });

  it('supports all typed result objects', async () => {
    const connector = createConnector('adapter_one', 'mock_kyc_1');
    const service = new WorkflowConnectorExecutorService([connector] as ConnectorAdapterCollection);
    const declarations = [
      declaration({ name: 'declaration_one', type: 'mock_kyc_1', order: 1, fieldMapping: {} }),
    ];

    connector.verify.mockResolvedValueOnce(ConnectorExecutionResult.invalid());
    const invalidResult = await service.execute(
      declarations,
      {},
      {
        onboardingId: 'onboarding-123',
        stepName: 'step',
      },
    );
    expect(invalidResult.isInvalid()).toBe(true);

    connector.verify.mockResolvedValueOnce(
      ConnectorExecutionResult.invalidData({ verificationCode: ['INVALID'] }),
    );
    const invalidDataResult = await service.execute(
      declarations,
      {},
      {
        onboardingId: 'onboarding-123',
        stepName: 'step',
      },
    );
    expect(invalidDataResult.isInvalidData()).toBe(true);
    expect(invalidDataResult.errors).toEqual({ verificationCode: ['INVALID'] });

    connector.verify.mockResolvedValueOnce(ConnectorExecutionResult.rejected('CONNECTOR_REJECTED'));
    const rejectedResult = await service.execute(
      declarations,
      {},
      {
        onboardingId: 'onboarding-123',
        stepName: 'step',
      },
    );
    expect(rejectedResult.isRejected()).toBe(true);
    expect(rejectedResult.reason).toBe('CONNECTOR_REJECTED');
  });

  it('throws when there is no adapter match for the declaration type', async () => {
    const connector = createConnector('adapter_one', 'mock_kyc_1');
    const service = new WorkflowConnectorExecutorService([connector] as ConnectorAdapterCollection);

    await expect(
      service.execute(
        [
          declaration({
            name: 'declaration_one',
            type: 'missing_type',
            order: 1,
            fieldMapping: {},
          }),
        ],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      ),
    ).rejects.toThrow('Connector adapter not registered for type=missing_type');
  });

  it('throws when more than one adapter has the same declaration type', async () => {
    const firstConnector = createConnector('adapter_one', 'mock_kyc_1');
    const duplicateConnector = createConnector('adapter_two', 'mock_kyc_1');
    const service = new WorkflowConnectorExecutorService([
      firstConnector,
      duplicateConnector,
    ] as ConnectorAdapterCollection);

    await expect(
      service.execute(
        [declaration({ name: 'declaration_one', type: 'mock_kyc_1', order: 1, fieldMapping: {} })],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      ),
    ).rejects.toThrow('Duplicate connector adapter registration for type=mock_kyc_1');
  });

  it('executes declarations in ascending order and waits for each connector sequentially', async () => {
    const firstConnector = createConnector('adapter_one', 'mock_kyc_1');
    const secondConnector = createConnector('adapter_two', 'mock_kyc_2');
    const service = new WorkflowConnectorExecutorService([
      secondConnector,
      firstConnector,
    ] as ConnectorAdapterCollection);
    const calls: string[] = [];
    const firstGate = createDeferred<ConnectorExecutionResult>();

    firstConnector.verify.mockImplementation(async () => {
      calls.push('first');
      return firstGate.promise;
    });
    secondConnector.verify.mockImplementation(async () => {
      calls.push('second');
      return ConnectorExecutionResult.accepted();
    });

    const execution = service.execute(
      [
        declaration({ name: 'second', type: 'mock_kyc_2', order: 2, fieldMapping: {} }),
        declaration({ name: 'first', type: 'mock_kyc_1', order: 1, fieldMapping: {} }),
      ],
      {},
      { onboardingId: 'onboarding-123', stepName: 'step' },
    );

    await Promise.resolve();
    expect(firstConnector.verify).toHaveBeenCalledTimes(1);
    expect(secondConnector.verify).not.toHaveBeenCalled();

    firstGate.resolve(ConnectorExecutionResult.accepted());
    await execution;

    expect(calls).toEqual(['first', 'second']);
  });

  it('short-circuits after the first non-accepted outcome', async () => {
    const firstConnector = createConnector('adapter_one', 'mock_kyc_1');
    const secondConnector = createConnector('adapter_two', 'mock_kyc_2');
    const service = new WorkflowConnectorExecutorService([
      secondConnector,
      firstConnector,
    ] as ConnectorAdapterCollection);

    firstConnector.verify.mockResolvedValueOnce(
      ConnectorExecutionResult.invalidData({ verificationCode: ['INVALID'] }),
    );

    await expect(
      service.execute(
        [
          declaration({ name: 'second', type: 'mock_kyc_2', order: 2, fieldMapping: {} }),
          declaration({ name: 'first', type: 'mock_kyc_1', order: 1, fieldMapping: {} }),
        ],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      ),
    ).resolves.toEqual(ConnectorExecutionResult.invalidData({ verificationCode: ['INVALID'] }));

    expect(firstConnector.verify).toHaveBeenCalledTimes(1);
    expect(secondConnector.verify).not.toHaveBeenCalled();
  });

  it('builds payload from the full runtime context and throws on missing mapped fields', async () => {
    const connector = createConnector('adapter_one', 'mock_kyc_1');
    const service = new WorkflowConnectorExecutorService([connector] as ConnectorAdapterCollection);

    await expect(
      service.execute(
        [
          declaration({
            name: 'declaration_one',
            type: 'mock_kyc_1',
            order: 1,
            fieldMapping: { email: 'email', acceptedTerms: 'acceptedTerms' },
          }),
        ],
        { email: 'person@example.com', acceptedTerms: true },
        { onboardingId: 'onboarding-123', stepName: 'step' },
      ),
    ).resolves.toEqual(ConnectorExecutionResult.accepted());

    expect(connector.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { email: 'person@example.com', acceptedTerms: true },
        payloadFieldSources: { email: 'email', acceptedTerms: 'acceptedTerms' },
      }),
    );

    await expect(
      service.execute(
        [
          declaration({
            name: 'declaration_one',
            type: 'mock_kyc_1',
            order: 1,
            fieldMapping: { missing: 'missingField' },
          }),
        ],
        { email: 'person@example.com' },
        { onboardingId: 'onboarding-123', stepName: 'step' },
      ),
    ).rejects.toBeInstanceOf(ConnectorPayloadFieldNotFoundError);
  });
});
