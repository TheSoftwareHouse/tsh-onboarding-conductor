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

const createConnector = (
  name: string,
  type: string,
  supportsAsyncCallback = false,
): ConnectorAdapter & { execute: jest.Mock } => ({
  name,
  type,
  supportsAsyncCallback,
  execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
});

const declaration = (
  overrides: Partial<NormalizedWorkflowConnectorDeclaration> &
    Pick<NormalizedWorkflowConnectorDeclaration, 'name' | 'type' | 'order' | 'fieldMapping'>,
): NormalizedWorkflowConnectorDeclaration => ({
  async: false,
  canReject: false,
  config: {},
  ...overrides,
});

describe('WorkflowConnectorExecutorService', () => {
  it('forwards declaration config content, mapped payload, copied context, and execution identity', async () => {
    const connector = createConnector('adapter_one', 'mock_kyc_1');
    const service = new WorkflowConnectorExecutorService([connector] as ConnectorAdapterCollection);
    const context = { email: 'person@example.com', acceptedTerms: true };
    const execution = { onboardingId: 'onboarding-123', stepName: 'collect_email' };
    const config = { maxAttempts: 3, nested: { enabled: true } };

    await expect(
      service.execute(
        [
          declaration({
            name: 'declaration_one',
            type: 'mock_kyc_1',
            order: 1,
            config,
            fieldMapping: { code: 'email' },
          }),
        ],
        context,
        execution,
      ),
    ).resolves.toEqual(ConnectorExecutionResult.accepted());

    expect(connector.execute).toHaveBeenCalledWith({
      declaration: {
        order: 1,
        config: {
          maxAttempts: 3,
          nested: {
            enabled: true,
          },
        },
      },
      execution,
      context: { email: 'person@example.com', acceptedTerms: true },
      payload: { code: 'person@example.com' },
      payloadFieldSources: { code: 'email' },
    });

    const input = connector.execute.mock.calls[0][0] as {
      declaration: { order: number; config: Record<string, unknown> };
      execution: { onboardingId: string; stepName: string };
      context: Record<string, unknown>;
      payload: Record<string, unknown>;
      payloadFieldSources: Record<string, string>;
    };

    expect(input.execution).not.toBe(execution);
    expect(input.context).not.toBe(context);
    expect(input.declaration.config).toEqual(config);
    expect(input.declaration.config).not.toBe(config);
    expect(input.declaration.config.nested).toEqual(config.nested);
    expect(input.declaration.config.nested).not.toBe(config.nested);
  });

  it('supports all typed result objects', async () => {
    const connector = createConnector('adapter_one', 'mock_kyc_1');
    const service = new WorkflowConnectorExecutorService([connector] as ConnectorAdapterCollection);
    const declarations = [
      declaration({ name: 'declaration_one', type: 'mock_kyc_1', order: 1, fieldMapping: {} }),
    ];

    connector.execute.mockResolvedValueOnce(ConnectorExecutionResult.invalid());
    const invalidResult = await service.execute(
      declarations,
      {},
      {
        onboardingId: 'onboarding-123',
        stepName: 'step',
      },
    );
    expect(invalidResult.isInvalid()).toBe(true);

    connector.execute.mockResolvedValueOnce(
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

    connector.execute.mockResolvedValueOnce(
      ConnectorExecutionResult.rejected('CONNECTOR_REJECTED'),
    );
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

  it('preserves accepted metadata for the normal single-connector path without injecting extra keys', async () => {
    const connector = createConnector('adapter_one', 'mock_kyc_1');
    const service = new WorkflowConnectorExecutorService([connector] as ConnectorAdapterCollection);
    const metadata = {
      auditTag: 'accepted-single',
      traceId: 'trace-123',
    } as const;

    connector.execute.mockResolvedValueOnce(ConnectorExecutionResult.accepted(metadata));

    const result = await service.execute(
      [declaration({ name: 'declaration_one', type: 'mock_kyc_1', order: 1, fieldMapping: {} })],
      {},
      {
        onboardingId: 'onboarding-123',
        stepName: 'step',
      },
    );

    expect(result).toEqual(ConnectorExecutionResult.accepted(metadata));
  });

  it('returns the last accepted connector result through a fully accepted multi-connector chain', async () => {
    const firstConnector = createConnector('adapter_one', 'mock_kyc_1');
    const secondConnector = createConnector('adapter_two', 'mock_kyc_2');
    const service = new WorkflowConnectorExecutorService([
      firstConnector,
      secondConnector,
    ] as ConnectorAdapterCollection);

    const firstMetadata = {
      auditTag: 'first-accepted',
      traceId: 'trace-first',
    } as const;
    const secondMetadata = {
      auditTag: 'last-accepted',
    } as const;

    firstConnector.execute.mockResolvedValueOnce(ConnectorExecutionResult.accepted(firstMetadata));
    secondConnector.execute.mockResolvedValueOnce(
      ConnectorExecutionResult.accepted(secondMetadata),
    );

    const result = await service.execute(
      [
        declaration({ name: 'declaration_one', type: 'mock_kyc_1', order: 1, fieldMapping: {} }),
        declaration({ name: 'declaration_two', type: 'mock_kyc_2', order: 2, fieldMapping: {} }),
      ],
      {},
      {
        onboardingId: 'onboarding-123',
        stepName: 'step',
      },
    );

    expect(result).toEqual(ConnectorExecutionResult.accepted(secondMetadata));
  });

  it('treats explicit async false as the synchronous execute path', async () => {
    const connector = createConnector('adapter_one', 'mock_kyc_1');
    const service = new WorkflowConnectorExecutorService([connector] as ConnectorAdapterCollection);

    await expect(
      service.execute(
        [
          declaration({
            name: 'declaration_one',
            type: 'mock_kyc_1',
            order: 1,
            async: false,
            fieldMapping: {},
          }),
        ],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      ),
    ).resolves.toEqual(ConnectorExecutionResult.accepted());

    expect(connector.execute).toHaveBeenCalledTimes(1);
  });

  it('keeps backward-compatible synchronous behavior when async is omitted', async () => {
    const connector = createConnector('adapter_one', 'mock_kyc_1');
    const service = new WorkflowConnectorExecutorService([connector] as ConnectorAdapterCollection);
    const declarationWithoutAsync = {
      name: 'declaration_one',
      type: 'mock_kyc_1',
      order: 1,
      canReject: false,
      config: {},
      fieldMapping: {},
    } as unknown as NormalizedWorkflowConnectorDeclaration;

    await expect(
      service.execute(
        [declarationWithoutAsync],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      ),
    ).resolves.toEqual(ConnectorExecutionResult.accepted());

    expect(connector.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects async declarations when adapter does not support async callbacks', async () => {
    const connector = createConnector('adapter_one', 'mock_kyc_1');
    const service = new WorkflowConnectorExecutorService([connector] as ConnectorAdapterCollection);

    await expect(
      service.execute(
        [
          declaration({
            name: 'declaration_one',
            type: 'mock_kyc_1',
            order: 1,
            async: true,
            fieldMapping: {},
          }),
        ],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      ),
    ).rejects.toThrow(
      'Async callback is not supported for connector type=mock_kyc_1 and connector name=declaration_one',
    );

    expect(connector.execute).not.toHaveBeenCalled();
  });

  it('calls async adapter.execute and converts accepted initiation into pending', async () => {
    const asyncConnector = createConnector('adapter_one', 'mock_kyc_1', true);
    const service = new WorkflowConnectorExecutorService([
      asyncConnector,
    ] as ConnectorAdapterCollection);
    const context = { email: 'person@example.com' };
    const execution = { onboardingId: 'onboarding-123', stepName: 'step' };

    await expect(
      service.execute(
        [
          declaration({
            name: 'declaration_one',
            type: 'mock_kyc_1',
            order: 1,
            async: true,
            fieldMapping: {},
          }),
          declaration({
            name: 'declaration_two',
            type: 'missing_connector_type',
            order: 2,
            async: false,
            fieldMapping: {},
          }),
        ],
        context,
        execution,
      ),
    ).resolves.toEqual(
      ConnectorExecutionResult.pending({
        connectorName: 'declaration_one',
        connectorType: 'mock_kyc_1',
        connectorOrder: 1,
      }),
    );

    expect(asyncConnector.execute).toHaveBeenCalledTimes(1);
    expect(asyncConnector.execute).toHaveBeenCalledWith({
      declaration: {
        order: 1,
        config: {},
      },
      execution,
      context: { email: 'person@example.com' },
      payload: {},
      payloadFieldSources: {},
    });
  });

  it('returns non-accepted async initiation result and does not run later connectors', async () => {
    const asyncConnector = createConnector('adapter_one', 'mock_kyc_1', true);
    const laterConnector = createConnector('adapter_two', 'mock_kyc_2');
    const service = new WorkflowConnectorExecutorService([
      asyncConnector,
      laterConnector,
    ] as ConnectorAdapterCollection);

    asyncConnector.execute.mockResolvedValueOnce(
      ConnectorExecutionResult.invalidData({ code: ['BAD'] }),
    );

    await expect(
      service.execute(
        [
          declaration({
            name: 'declaration_one',
            type: 'mock_kyc_1',
            order: 1,
            async: true,
            fieldMapping: {},
          }),
          declaration({
            name: 'declaration_two',
            type: 'mock_kyc_2',
            order: 2,
            async: false,
            fieldMapping: {},
          }),
        ],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      ),
    ).resolves.toEqual(ConnectorExecutionResult.invalidData({ code: ['BAD'] }));

    expect(asyncConnector.execute).toHaveBeenCalledTimes(1);
    expect(laterConnector.execute).not.toHaveBeenCalled();
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

    firstConnector.execute.mockImplementation(async () => {
      calls.push('first');
      return firstGate.promise;
    });
    secondConnector.execute.mockImplementation(async () => {
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
    expect(firstConnector.execute).toHaveBeenCalledTimes(1);
    expect(secondConnector.execute).not.toHaveBeenCalled();

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

    firstConnector.execute.mockResolvedValueOnce(
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

    expect(firstConnector.execute).toHaveBeenCalledTimes(1);
    expect(secondConnector.execute).not.toHaveBeenCalled();
  });

  it('evaluates the resolved connector result and then continues later connectors serially', async () => {
    const firstConnector = createConnector('adapter_one', 'mock_kyc_1');
    const secondConnector = createConnector('adapter_two', 'mock_kyc_2');
    const thirdConnector = createConnector('adapter_three', 'mock_kyc_3');
    const service = new WorkflowConnectorExecutorService([
      firstConnector,
      secondConnector,
      thirdConnector,
    ] as ConnectorAdapterCollection);
    const calls: string[] = [];
    const secondGate = createDeferred<ConnectorExecutionResult>();

    firstConnector.execute.mockImplementation(async () => {
      calls.push('first');
      return ConnectorExecutionResult.accepted();
    });
    secondConnector.execute.mockImplementation(async () => {
      calls.push('second');
      return secondGate.promise;
    });
    thirdConnector.execute.mockImplementation(async () => {
      calls.push('third');
      return ConnectorExecutionResult.accepted();
    });

    const continuation = service.continueAfter(
      [
        declaration({ name: 'first', type: 'mock_kyc_1', order: 1, fieldMapping: {} }),
        declaration({ name: 'second', type: 'mock_kyc_2', order: 2, fieldMapping: {} }),
        declaration({ name: 'third', type: 'mock_kyc_3', order: 3, fieldMapping: {} }),
      ],
      {},
      { onboardingId: 'onboarding-123', stepName: 'step' },
      1,
      ConnectorExecutionResult.accepted(),
    );

    await Promise.resolve();
    expect(firstConnector.execute).not.toHaveBeenCalled();
    expect(secondConnector.execute).toHaveBeenCalledTimes(1);
    expect(thirdConnector.execute).not.toHaveBeenCalled();

    secondGate.resolve(ConnectorExecutionResult.accepted());
    await continuation;

    expect(calls).toEqual(['second', 'third']);
  });

  it('short-circuits continuation when the resolved connector result is not accepted', async () => {
    const firstConnector = createConnector('adapter_one', 'mock_kyc_1');
    const secondConnector = createConnector('adapter_two', 'mock_kyc_2');
    const service = new WorkflowConnectorExecutorService([
      firstConnector,
      secondConnector,
    ] as ConnectorAdapterCollection);

    const result = await service.continueAfter(
      [
        declaration({ name: 'first', type: 'mock_kyc_1', order: 1, fieldMapping: {} }),
        declaration({ name: 'second', type: 'mock_kyc_2', order: 2, fieldMapping: {} }),
      ],
      {},
      { onboardingId: 'onboarding-123', stepName: 'step' },
      1,
      ConnectorExecutionResult.rejected('CONNECTOR_REJECTED'),
    );

    expect(result.isRejected()).toBe(true);
    expect(result.reason).toBe('CONNECTOR_REJECTED');
    expect(firstConnector.execute).not.toHaveBeenCalled();
    expect(secondConnector.execute).not.toHaveBeenCalled();
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

    expect(connector.execute).toHaveBeenCalledWith(
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

  it('throws when a connector mapping references an inactive conditional source that is absent in context', async () => {
    const connector = createConnector('adapter_one', 'mock_kyc_1');
    const service = new WorkflowConnectorExecutorService([connector] as ConnectorAdapterCollection);

    await expect(
      service.execute(
        [
          declaration({
            name: 'declaration_one',
            type: 'mock_kyc_1',
            order: 1,
            fieldMapping: {
              country: 'country',
              taxId: 'taxId',
              currentOnly: 'currentOnly',
            },
          }),
        ],
        { country: 'CA' },
        { onboardingId: 'onboarding-123', stepName: 'collect_details' },
      ),
    ).rejects.toBeInstanceOf(ConnectorPayloadFieldNotFoundError);
  });

  it('resolves callback-capable adapters by connector type', () => {
    const connector = {
      ...createConnector('adapter_one', 'mock_async_callback', true),
      mapCallbackResult: jest.fn(),
    } as ConnectorAdapter;
    const service = new WorkflowConnectorExecutorService([connector] as ConnectorAdapterCollection);

    const resolved = service.resolveAsyncCallbackAdapterByType('mock_async_callback');

    expect(resolved).toBe(connector);
  });

  it('rejects callback adapter resolution when callback mapping is unsupported', () => {
    const connector = createConnector('adapter_one', 'mock_async_callback', false);
    const service = new WorkflowConnectorExecutorService([connector] as ConnectorAdapterCollection);

    expect(() => service.resolveAsyncCallbackAdapterByType('mock_async_callback')).toThrow(
      'Callback mapping is not supported for connector type=mock_async_callback',
    );
  });
});
