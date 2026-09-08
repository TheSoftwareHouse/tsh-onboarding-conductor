import * as timersPromises from 'node:timers/promises';
import {
  DEFAULT_CONNECTOR_RETRY,
  type NormalizedWorkflowConnectorDeclaration,
} from '@tsh/ddl-schema';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AuditService } from '../audit/audit.service';
import type { ConnectorFailureAuditInput, ConnectorOutcomeAuditInput } from '../audit/audit.types';
import { ContinueOnErrorHandler } from './error-handlers/built-in/continue-on-error.handler';
import { FallbackOnErrorHandler } from './error-handlers/built-in/fallback-on-error.handler';
import { RetryThenFallbackHandler } from './error-handlers/built-in/retry-then-fallback.handler';
import { ConnectorAdapterNotRegisteredError } from './errors/connector-adapter-not-registered.error';
import { ConnectorErrorHandlerNotRegisteredError } from './errors/connector-error-handler-not-registered.error';
import { ConnectorPayloadFieldNotFoundError } from './errors/connector-payload-field-not-found.error';
import { ConnectorTypeMismatchError } from './errors/connector-type-mismatch.error';
import type { ConnectorAdapter, ConnectorAdapterCollection } from './ports/connector-adapter.port';
import {
  ConnectorFailureAction,
  type ConnectorErrorHandler,
  type ConnectorErrorHandlerCollection,
  type ConnectorFailure,
} from './ports/connector-error-handler.port';
import { ConnectorExecutionResult } from './ports/connector-execution-result';
import {
  MAX_PENDING_CONNECTOR_FAILURE_AUDITS,
  WorkflowConnectorExecutorService,
} from './workflow-connector-executor.service';

// The retry interval is waited through `node:timers/promises`, whose exports cannot be spied on.
// Mocking the module keeps every assertion about *what the executor decided to wait* rather than
// about real elapsed time, and keeps the suite instant.
jest.mock('node:timers/promises', () => ({
  setTimeout: jest.fn(() => Promise.resolve(undefined)),
}));

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
  id: string,
  supportsAsyncCallback = false,
): ConnectorAdapter & { execute: jest.Mock } => ({
  name,
  id,
  type: 'custom',
  supportsAsyncCallback,
  execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
});

const declaration = (
  overrides: Partial<NormalizedWorkflowConnectorDeclaration> &
    Pick<NormalizedWorkflowConnectorDeclaration, 'name' | 'id' | 'order' | 'fieldMapping'>,
): NormalizedWorkflowConnectorDeclaration => ({
  async: false,
  canReject: false,
  config: {},
  optionalFieldMapping: {},
  // Matches `createConnector`'s capability, so a declaration never contradicts its adapter.
  type: 'custom',
  ...overrides,
  retry: overrides.retry ?? DEFAULT_CONNECTOR_RETRY,
  fallbacks: overrides.fallbacks ?? [],
});

/** The three built-in handlers, wired exactly as `ConnectorsModule` wires them. */
const defaultErrorHandlers = (): ConnectorErrorHandlerCollection => [
  new FallbackOnErrorHandler(),
  new RetryThenFallbackHandler(),
  new ContinueOnErrorHandler(),
];

const createHandler = (
  id: string,
  handle: (failure: ConnectorFailure) => ConnectorFailureAction,
): ConnectorErrorHandler => ({ id, handle });

const createAuditServiceMock = (): AuditService & {
  logConnectorFailure: jest.Mock;
  logConnectorOutcome: jest.Mock;
} =>
  ({
    logConnectorFailure: jest.fn().mockResolvedValue(undefined),
    logConnectorOutcome: jest.fn().mockResolvedValue(undefined),
  }) as unknown as AuditService & {
    logConnectorFailure: jest.Mock;
    logConnectorOutcome: jest.Mock;
  };

const createService = (
  connectors: ConnectorAdapterCollection,
  options: {
    errorHandlers?: ConnectorErrorHandlerCollection;
    auditService?: AuditService;
  } = {},
): WorkflowConnectorExecutorService =>
  new WorkflowConnectorExecutorService(
    connectors,
    options.errorHandlers ?? defaultErrorHandlers(),
    options.auditService ?? createAuditServiceMock(),
    {} as DataSource,
  );

describe('WorkflowConnectorExecutorService', () => {
  it('forwards declaration config content, mapped payload, copied context, and execution identity', async () => {
    const connector = createConnector('adapter_one', 'mock_kyc_1');
    const service = createService([connector] as ConnectorAdapterCollection);
    const context = { email: 'person@example.com', acceptedTerms: true };
    const execution = { onboardingId: 'onboarding-123', stepName: 'collect_email' };
    const config = { maxAttempts: 3, nested: { enabled: true } };

    await expect(
      service.execute(
        [
          declaration({
            name: 'declaration_one',
            id: 'mock_kyc_1',
            type: 'kyc',
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
        async: false,
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
    const service = createService([connector] as ConnectorAdapterCollection);
    const declarations = [
      declaration({ name: 'declaration_one', id: 'mock_kyc_1', order: 1, fieldMapping: {} }),
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
    const service = createService([connector] as ConnectorAdapterCollection);
    const metadata = {
      auditTag: 'accepted-single',
      traceId: 'trace-123',
    } as const;

    connector.execute.mockResolvedValueOnce(ConnectorExecutionResult.accepted(metadata));

    const result = await service.execute(
      [declaration({ name: 'declaration_one', id: 'mock_kyc_1', order: 1, fieldMapping: {} })],
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
    const service = createService([firstConnector, secondConnector] as ConnectorAdapterCollection);

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
        declaration({ name: 'declaration_one', id: 'mock_kyc_1', order: 1, fieldMapping: {} }),
        declaration({ name: 'declaration_two', id: 'mock_kyc_2', order: 2, fieldMapping: {} }),
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
    const service = createService([connector] as ConnectorAdapterCollection);

    await expect(
      service.execute(
        [
          declaration({
            name: 'declaration_one',
            id: 'mock_kyc_1',
            type: 'kyc',
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
    const service = createService([connector] as ConnectorAdapterCollection);
    const declarationWithoutAsync = {
      name: 'declaration_one',
      id: 'mock_kyc_1',
      type: 'kyc',
      order: 1,
      canReject: false,
      config: {},
      fieldMapping: {},
      retry: DEFAULT_CONNECTOR_RETRY,
      fallbacks: [],
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
    const service = createService([connector] as ConnectorAdapterCollection);

    await expect(
      service.execute(
        [
          declaration({
            name: 'declaration_one',
            id: 'mock_kyc_1',
            type: 'kyc',
            order: 1,
            async: true,
            fieldMapping: {},
          }),
        ],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      ),
    ).rejects.toThrow(
      'Async callback is not supported for connector id=mock_kyc_1 and connector name=declaration_one',
    );

    expect(connector.execute).not.toHaveBeenCalled();
  });

  it('calls async adapter.execute and converts accepted initiation into pending', async () => {
    const asyncConnector = createConnector('adapter_one', 'mock_kyc_1', true);
    const service = createService([asyncConnector] as ConnectorAdapterCollection);
    const context = { email: 'person@example.com' };
    const execution = { onboardingId: 'onboarding-123', stepName: 'step' };

    await expect(
      service.execute(
        [
          declaration({
            name: 'declaration_one',
            id: 'mock_kyc_1',
            type: 'kyc',
            order: 1,
            async: true,
            fieldMapping: {},
          }),
          declaration({
            name: 'declaration_two',
            id: 'missing_connector_type',
            type: 'custom',
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
        connectorId: 'mock_kyc_1',
        connectorOrder: 1,
      }),
    );

    expect(asyncConnector.execute).toHaveBeenCalledTimes(1);
    expect(asyncConnector.execute).toHaveBeenCalledWith({
      declaration: {
        order: 1,
        config: {},
        async: true,
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
    const service = createService([asyncConnector, laterConnector] as ConnectorAdapterCollection);

    asyncConnector.execute.mockResolvedValueOnce(
      ConnectorExecutionResult.invalidData({ code: ['BAD'] }),
    );

    await expect(
      service.execute(
        [
          declaration({
            name: 'declaration_one',
            id: 'mock_kyc_1',
            type: 'kyc',
            order: 1,
            async: true,
            fieldMapping: {},
          }),
          declaration({
            name: 'declaration_two',
            id: 'mock_kyc_2',
            type: 'kyc',
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

  it('throws when there is no adapter match for the declared id', async () => {
    const connector = createConnector('adapter_one', 'mock_kyc_1');
    const service = createService([connector] as ConnectorAdapterCollection);

    await expect(
      service.execute(
        [
          declaration({
            name: 'declaration_one',
            id: 'missing_type',
            order: 1,
            fieldMapping: {},
          }),
        ],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      ),
    ).rejects.toThrow('Connector adapter not registered for id=missing_type');
  });

  it('throws when more than one adapter has the same declared id', async () => {
    const firstConnector = createConnector('adapter_one', 'mock_kyc_1');
    const duplicateConnector = createConnector('adapter_two', 'mock_kyc_1');
    const service = createService([
      firstConnector,
      duplicateConnector,
    ] as ConnectorAdapterCollection);

    await expect(
      service.execute(
        [declaration({ name: 'declaration_one', id: 'mock_kyc_1', order: 1, fieldMapping: {} })],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      ),
    ).rejects.toThrow('Duplicate connector adapter registration for id=mock_kyc_1');
  });

  it('executes declarations in ascending order and waits for each connector sequentially', async () => {
    const firstConnector = createConnector('adapter_one', 'mock_kyc_1');
    const secondConnector = createConnector('adapter_two', 'mock_kyc_2');
    const service = createService([secondConnector, firstConnector] as ConnectorAdapterCollection);
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
        declaration({ name: 'second', id: 'mock_kyc_2', order: 2, fieldMapping: {} }),
        declaration({ name: 'first', id: 'mock_kyc_1', order: 1, fieldMapping: {} }),
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
    const service = createService([secondConnector, firstConnector] as ConnectorAdapterCollection);

    firstConnector.execute.mockResolvedValueOnce(
      ConnectorExecutionResult.invalidData({ verificationCode: ['INVALID'] }),
    );

    await expect(
      service.execute(
        [
          declaration({ name: 'second', id: 'mock_kyc_2', order: 2, fieldMapping: {} }),
          declaration({ name: 'first', id: 'mock_kyc_1', order: 1, fieldMapping: {} }),
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
    const service = createService([
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

    const continuation = service.resume(
      [
        declaration({ name: 'first', id: 'mock_kyc_1', order: 1, fieldMapping: {} }),
        declaration({ name: 'second', id: 'mock_kyc_2', order: 2, fieldMapping: {} }),
        declaration({ name: 'third', id: 'mock_kyc_3', order: 3, fieldMapping: {} }),
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
    const service = createService([firstConnector, secondConnector] as ConnectorAdapterCollection);

    const result = await service.resume(
      [
        declaration({ name: 'first', id: 'mock_kyc_1', order: 1, fieldMapping: {} }),
        declaration({ name: 'second', id: 'mock_kyc_2', order: 2, fieldMapping: {} }),
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
    const service = createService([connector] as ConnectorAdapterCollection);

    await expect(
      service.execute(
        [
          declaration({
            name: 'declaration_one',
            id: 'mock_kyc_1',
            type: 'kyc',
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
            id: 'mock_kyc_1',
            type: 'kyc',
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
    const service = createService([connector] as ConnectorAdapterCollection);

    await expect(
      service.execute(
        [
          declaration({
            name: 'declaration_one',
            id: 'mock_kyc_1',
            type: 'kyc',
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
    const service = createService([connector] as ConnectorAdapterCollection);

    const resolved = service.findAdapterById('mock_async_callback');

    expect(resolved).toBe(connector);
  });

  it('rejects callback adapter resolution when callback mapping is unsupported', () => {
    const connector = createConnector('adapter_one', 'mock_async_callback', false);
    const service = createService([connector] as ConnectorAdapterCollection);

    expect(() => service.findAdapterById('mock_async_callback')).toThrow(
      'Callback mapping is not supported for connector id=mock_async_callback',
    );
  });

  describe('validateDeclarations', () => {
    it('hands each declaration to the adapter that exposes validation', () => {
      const validating = {
        ...createConnector('adapter_one', 'http_request'),
        validateDeclaration: jest.fn(),
      } as ConnectorAdapter & { validateDeclaration: jest.Mock };
      const service = createService([validating] as ConnectorAdapterCollection);
      const httpDeclaration = declaration({
        name: 'declaration_one',
        id: 'http_request',
        type: 'custom',
        order: 1,
        fieldMapping: {},
      });

      service.validateDeclarations([httpDeclaration]);

      expect(validating.validateDeclaration).toHaveBeenCalledWith(httpDeclaration);
    });

    it('refuses a declaration whose type contradicts its adapter', () => {
      const connector = createConnector('adapter_one', 'acme_kyc');
      const service = createService([connector] as ConnectorAdapterCollection);

      // The adapter is `custom`; the workflow claims `kyc`. The adapter is the authority.
      expect(() =>
        service.validateDeclarations([
          declaration({
            name: 'declaration_one',
            id: 'acme_kyc',
            type: 'kyc',
            order: 1,
            fieldMapping: {},
          }),
        ]),
      ).toThrow(
        'Connector declaration for id=acme_kyc declares type=kyc, but the registered adapter is type=custom',
      );
    });

    it('leaves an unregistered id to fail at execution time rather than at validation', () => {
      const service = createService([] as ConnectorAdapterCollection);

      expect(() =>
        service.validateDeclarations([
          declaration({
            name: 'declaration_one',
            id: 'nobody',
            type: 'kyc',
            order: 1,
            fieldMapping: {},
          }),
        ]),
      ).not.toThrow();
    });

    it('propagates the adapter validation failure', () => {
      const validating = {
        ...createConnector('adapter_one', 'http_request'),
        validateDeclaration: jest.fn().mockImplementation(() => {
          throw new Error('request.url must be a non-empty string');
        }),
      } as ConnectorAdapter;
      const service = createService([validating] as ConnectorAdapterCollection);

      expect(() =>
        service.validateDeclarations([
          declaration({
            name: 'declaration_one',
            id: 'http_request',
            type: 'custom',
            order: 1,
            fieldMapping: {},
          }),
        ]),
      ).toThrow('request.url must be a non-empty string');
    });

    it('skips adapters without a validation hook', () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      const service = createService([connector] as ConnectorAdapterCollection);

      expect(() =>
        service.validateDeclarations([
          declaration({ name: 'declaration_one', id: 'mock_kyc_1', order: 1, fieldMapping: {} }),
        ]),
      ).not.toThrow();
      expect(connector.execute).not.toHaveBeenCalled();
    });

    it('leaves an unregistered connector type to fail at execution time', () => {
      const service = createService([] as ConnectorAdapterCollection);

      expect(() =>
        service.validateDeclarations([
          declaration({
            name: 'declaration_one',
            id: 'not_registered',
            order: 1,
            fieldMapping: {},
          }),
        ]),
      ).not.toThrow();
    });
  });
  it('tells the adapter whether the engine will await a callback for this declaration', async () => {
    const connector = createConnector('adapter_one', 'mock_kyc_1', true);
    const service = createService([connector] as ConnectorAdapterCollection);

    await service.execute(
      [declaration({ name: 'sync_step', id: 'mock_kyc_1', order: 1, fieldMapping: {} })],
      {},
      { onboardingId: 'onboarding-123', stepName: 'collect' },
    );

    expect(connector.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({ declaration: expect.objectContaining({ async: false }) }),
    );

    await service.execute(
      [
        declaration({
          name: 'async_step',
          id: 'mock_kyc_1',
          type: 'kyc',
          order: 1,
          async: true,
          fieldMapping: {},
        }),
      ],
      {},
      { onboardingId: 'onboarding-123', stepName: 'collect' },
    );

    expect(connector.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({ declaration: expect.objectContaining({ async: true }) }),
    );
  });

  describe('fallback chains and retry policy', () => {
    const retryDelay = timersPromises.setTimeout as unknown as jest.Mock;

    beforeEach(() => {
      retryDelay.mockImplementation(() => Promise.resolve(undefined));
    });

    it('walks the whole chain, running each link only after the one before it failed', async () => {
      const primaryConnector = createConnector('primary', 'sendgrid_email');
      const secondConnector = createConnector('second', 'smtp');
      const lastConnector = createConnector('last', 'ses_email');
      const auditService = createAuditServiceMock();
      const service = createService(
        [primaryConnector, secondConnector, lastConnector] as ConnectorAdapterCollection,
        { auditService },
      );

      primaryConnector.execute.mockRejectedValue(new Error('primary down'));
      secondConnector.execute.mockRejectedValue(new Error('second down'));
      lastConnector.execute.mockResolvedValueOnce(ConnectorExecutionResult.accepted());

      const primary = declaration({
        name: 'primary_email',
        id: 'sendgrid_email',
        order: 1,
        retry: { maxAttempts: 1, delayMs: 0 },
        fieldMapping: {},
        fallbacks: [
          declaration({ name: 'second_email', id: 'smtp', order: 1, fieldMapping: {} }),
          declaration({ name: 'last_email', id: 'ses_email', order: 1, fieldMapping: {} }),
        ],
      });

      const result = await service.execute(
        [primary],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      );
      await service.flushConnectorFailureAudits();

      expect(result).toEqual(ConnectorExecutionResult.accepted());
      expect(primaryConnector.execute).toHaveBeenCalledTimes(1);
      expect(lastConnector.execute).toHaveBeenCalledTimes(1);

      const fellBack = (
        auditService.logConnectorFailure.mock.calls as [DataSource, ConnectorFailureAuditInput][]
      )
        .map(([, input]) => input)
        .filter((input) => input.action === 'connector.failure_fell_back');

      expect(
        fellBack.map(({ metadata }) => [metadata.fallbackConnectorId, metadata.fallbackPosition]),
      ).toEqual([
        ['smtp', 1],
        ['ses_email', 2],
      ]);
    });

    it('waits the declared interval before repeating a call, and records what it waited', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      connector.execute
        .mockRejectedValueOnce(new Error('flaky'))
        .mockResolvedValueOnce(ConnectorExecutionResult.accepted());
      const auditService = createAuditServiceMock();
      const service = createService([connector] as ConnectorAdapterCollection, { auditService });

      await service.execute(
        [
          declaration({
            name: 'declaration_one',
            id: 'mock_kyc_1',
            order: 1,
            errorHandler: 'retry_then_fallback',
            retry: { maxAttempts: 2, delayMs: 250 },
            fieldMapping: {},
          }),
        ],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      );
      await service.flushConnectorFailureAudits();

      expect(retryDelay).toHaveBeenCalledTimes(1);
      expect(retryDelay).toHaveBeenCalledWith(250);
      expect(connector.execute).toHaveBeenCalledTimes(2);

      const [[, retried]] = auditService.logConnectorFailure.mock.calls as [
        DataSource,
        ConnectorFailureAuditInput,
      ][];

      expect(retried.action).toBe('connector.failure_retried');
      expect(retried.metadata.retryDelayMs).toBe(250);
    });

    it('waits nothing, and records no interval, when the declared interval is zero', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      connector.execute
        .mockRejectedValueOnce(new Error('flaky'))
        .mockResolvedValueOnce(ConnectorExecutionResult.accepted());
      const auditService = createAuditServiceMock();
      const service = createService([connector] as ConnectorAdapterCollection, { auditService });

      await service.execute(
        [
          declaration({
            name: 'declaration_one',
            id: 'mock_kyc_1',
            order: 1,
            errorHandler: 'retry_then_fallback',
            fieldMapping: {},
          }),
        ],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      );
      await service.flushConnectorFailureAudits();

      expect(retryDelay).not.toHaveBeenCalled();

      const [[, retried]] = auditService.logConnectorFailure.mock.calls as [
        DataSource,
        ConnectorFailureAuditInput,
      ][];

      expect(retried.metadata).not.toHaveProperty('retryDelayMs');
    });

    it('stops retrying once the slot has spent its waiting budget, whatever the chain declares', async () => {
      const primaryConnector = createConnector('primary', 'sendgrid_email');
      const fallbackConnector = createConnector('fallback', 'smtp');
      const error = new Error('provider outage');
      primaryConnector.execute.mockRejectedValue(error);
      fallbackConnector.execute.mockRejectedValue(error);
      const auditService = createAuditServiceMock();
      const service = createService(
        [primaryConnector, fallbackConnector] as ConnectorAdapterCollection,
        { auditService },
      );

      // Five attempts waiting five seconds each spend the slot's whole budget on the primary, so
      // the fallback's first retry is the one the executor refuses.
      const exhausting = { maxAttempts: 5, delayMs: 5000 };

      await expect(
        service.execute(
          [
            declaration({
              name: 'primary_email',
              id: 'sendgrid_email',
              order: 1,
              errorHandler: 'retry_then_fallback',
              retry: exhausting,
              fieldMapping: {},
              fallbacks: [
                declaration({
                  name: 'backup_email',
                  id: 'smtp',
                  order: 1,
                  retry: exhausting,
                  fieldMapping: {},
                }),
              ],
            }),
          ],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        ),
      ).rejects.toBe(error);
      await service.flushConnectorFailureAudits();

      expect(retryDelay).toHaveBeenCalledTimes(4);
      expect(primaryConnector.execute).toHaveBeenCalledTimes(5);
      expect(fallbackConnector.execute).toHaveBeenCalledTimes(1);

      const calls = auditService.logConnectorFailure.mock.calls as [
        DataSource,
        ConnectorFailureAuditInput,
      ][];
      const [, propagated] = calls[calls.length - 1];

      expect(propagated.action).toBe('connector.failure_propagated');
      expect(propagated.metadata.override).toBe('retry_delay_budget_exhausted');
      expect(propagated.metadata.connectorId).toBe('smtp');
    });
  });

  describe('error handler dispatch', () => {
    it('falls back to the declared fallback using the default handler when none is named', async () => {
      const primaryConnector = createConnector('primary', 'sendgrid_email');
      const fallbackConnector = createConnector('fallback', 'smtp');
      const service = createService([
        primaryConnector,
        fallbackConnector,
      ] as ConnectorAdapterCollection);

      primaryConnector.execute.mockRejectedValueOnce(new Error('boom'));
      fallbackConnector.execute.mockResolvedValueOnce(ConnectorExecutionResult.accepted());

      const primary = declaration({
        name: 'primary_email',
        id: 'sendgrid_email',
        type: 'custom',
        order: 1,
        fieldMapping: {},
        fallbacks: [
          declaration({
            name: 'backup_email',
            id: 'smtp',
            type: 'custom',
            order: 1,
            fieldMapping: {},
          }),
        ],
      });

      const result = await service.execute(
        [primary],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      );

      expect(result).toEqual(ConnectorExecutionResult.accepted());
      expect(primaryConnector.execute).toHaveBeenCalledTimes(1);
      expect(fallbackConnector.execute).toHaveBeenCalledTimes(1);
    });

    it("runs the fallback with its own payload and config, not the primary's", async () => {
      const primaryConnector = createConnector('primary', 'sendgrid_email');
      const fallbackConnector = createConnector('fallback', 'smtp');
      const service = createService([
        primaryConnector,
        fallbackConnector,
      ] as ConnectorAdapterCollection);

      primaryConnector.execute.mockRejectedValueOnce(new Error('boom'));
      fallbackConnector.execute.mockResolvedValueOnce(ConnectorExecutionResult.accepted());

      const primary = declaration({
        name: 'primary_email',
        id: 'sendgrid_email',
        type: 'custom',
        order: 1,
        config: { templateId: 'primary-template' },
        fieldMapping: { recipient: 'email' },
        fallbacks: [
          declaration({
            name: 'backup_email',
            id: 'smtp',
            type: 'custom',
            order: 1,
            config: { templatePath: 'fixtures/manual-smtp.html' },
            fieldMapping: { recipient: 'email', subject: 'subject' },
          }),
        ],
      });

      await service.execute(
        [primary],
        { email: 'person@example.com', subject: 'Welcome' },
        { onboardingId: 'onboarding-123', stepName: 'step' },
      );

      expect(fallbackConnector.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          declaration: expect.objectContaining({
            config: { templatePath: 'fixtures/manual-smtp.html' },
          }),
          payload: { recipient: 'person@example.com', subject: 'Welcome' },
          payloadFieldSources: { recipient: 'email', subject: 'subject' },
        }),
      );
    });

    it('retries once on a 5xx then falls back with retry_then_fallback', async () => {
      const primaryConnector = createConnector('primary', 'sendgrid_email');
      const fallbackConnector = createConnector('fallback', 'smtp');
      const service = createService([
        primaryConnector,
        fallbackConnector,
      ] as ConnectorAdapterCollection);

      primaryConnector.execute.mockRejectedValue(new ServiceUnavailableException('unavailable'));
      fallbackConnector.execute.mockResolvedValueOnce(ConnectorExecutionResult.accepted());

      const primary = declaration({
        name: 'primary_email',
        id: 'sendgrid_email',
        type: 'custom',
        order: 1,
        errorHandler: 'retry_then_fallback',
        fieldMapping: {},
        fallbacks: [
          declaration({
            name: 'backup_email',
            id: 'smtp',
            type: 'custom',
            order: 1,
            fieldMapping: {},
          }),
        ],
      });

      const result = await service.execute(
        [primary],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      );

      expect(result).toEqual(ConnectorExecutionResult.accepted());
      expect(primaryConnector.execute).toHaveBeenCalledTimes(2);
      expect(fallbackConnector.execute).toHaveBeenCalledTimes(1);
    });

    it("stops retrying at the declaration's own attempt cap and propagates", async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      const error = new Error('always fails');
      connector.execute.mockRejectedValue(error);
      const alwaysRetry = createHandler('always_retry', () => ConnectorFailureAction.RETRY);
      const service = createService([connector] as ConnectorAdapterCollection, {
        errorHandlers: [alwaysRetry],
      });

      await expect(
        service.execute(
          [
            declaration({
              name: 'declaration_one',
              id: 'mock_kyc_1',
              order: 1,
              errorHandler: 'always_retry',
              fieldMapping: {},
            }),
          ],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        ),
      ).rejects.toBe(error);

      expect(connector.execute).toHaveBeenCalledTimes(DEFAULT_CONNECTOR_RETRY.maxAttempts);
    });

    it('spends the attempts the declaration asks for, not a default of the executor', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      const error = new Error('always fails');
      connector.execute.mockRejectedValue(error);
      const alwaysRetry = createHandler('always_retry', () => ConnectorFailureAction.RETRY);
      const service = createService([connector] as ConnectorAdapterCollection, {
        errorHandlers: [alwaysRetry],
      });

      await expect(
        service.execute(
          [
            declaration({
              name: 'declaration_one',
              id: 'mock_kyc_1',
              order: 1,
              errorHandler: 'always_retry',
              retry: { maxAttempts: 4, delayMs: 0 },
              fieldMapping: {},
            }),
          ],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        ),
      ).rejects.toBe(error);

      expect(connector.execute).toHaveBeenCalledTimes(4);
    });

    it('continues to the next declaration when the handler continues past a failure', async () => {
      const firstConnector = createConnector('first', 'mock_kyc_1');
      const secondConnector = createConnector('second', 'mock_kyc_2');
      firstConnector.execute.mockRejectedValueOnce(new Error('boom'));
      const service = createService([
        firstConnector,
        secondConnector,
      ] as ConnectorAdapterCollection);

      const result = await service.execute(
        [
          declaration({
            name: 'first',
            id: 'mock_kyc_1',
            order: 1,
            errorHandler: 'continue_on_error',
            fieldMapping: {},
          }),
          declaration({ name: 'second', id: 'mock_kyc_2', order: 2, fieldMapping: {} }),
        ],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      );

      expect(result).toEqual(ConnectorExecutionResult.accepted());
      expect(secondConnector.execute).toHaveBeenCalledTimes(1);
    });

    it('does not park an async declaration when the handler continues past a failure', async () => {
      const asyncConnector = createConnector('adapter_one', 'mock_kyc_1', true);
      asyncConnector.execute.mockRejectedValueOnce(new Error('boom'));
      const service = createService([asyncConnector] as ConnectorAdapterCollection);

      const result = await service.execute(
        [
          declaration({
            name: 'declaration_one',
            id: 'mock_kyc_1',
            order: 1,
            async: true,
            errorHandler: 'continue_on_error',
            fieldMapping: {},
          }),
        ],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      );

      expect(result).toEqual(ConnectorExecutionResult.accepted());
      expect(result.isPending()).toBe(false);
    });

    it('propagates the original error unchanged', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      const error = new Error('boom');
      connector.execute.mockRejectedValueOnce(error);
      const propagateHandler = createHandler(
        'always_propagate',
        () => ConnectorFailureAction.PROPAGATE,
      );
      const service = createService([connector] as ConnectorAdapterCollection, {
        errorHandlers: [propagateHandler],
      });

      await expect(
        service.execute(
          [
            declaration({
              name: 'declaration_one',
              id: 'mock_kyc_1',
              order: 1,
              errorHandler: 'always_propagate',
              fieldMapping: {},
            }),
          ],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        ),
      ).rejects.toBe(error);
    });

    it("propagates the fallback's own error when the fallback also throws", async () => {
      const primaryConnector = createConnector('primary', 'sendgrid_email');
      const fallbackConnector = createConnector('fallback', 'smtp');
      const primaryError = new Error('primary failed');
      const fallbackError = new Error('fallback failed');
      primaryConnector.execute.mockRejectedValueOnce(primaryError);
      fallbackConnector.execute.mockRejectedValueOnce(fallbackError);
      const service = createService([
        primaryConnector,
        fallbackConnector,
      ] as ConnectorAdapterCollection);

      const primary = declaration({
        name: 'primary_email',
        id: 'sendgrid_email',
        type: 'custom',
        order: 1,
        fieldMapping: {},
        fallbacks: [
          declaration({
            name: 'backup_email',
            id: 'smtp',
            type: 'custom',
            order: 1,
            fieldMapping: {},
          }),
        ],
      });

      await expect(
        service.execute([primary], {}, { onboardingId: 'onboarding-123', stepName: 'step' }),
      ).rejects.toBe(fallbackError);
    });

    it.each([
      ['rejected', ConnectorExecutionResult.rejected('CONNECTOR_REJECTED')],
      ['invalid-data', ConnectorExecutionResult.invalidData({ field: ['INVALID'] })],
      ['invalid', ConnectorExecutionResult.invalid()],
    ])(
      'never involves the handler or the fallback for a returned %s verdict',
      async (_label, verdict) => {
        const primaryConnector = createConnector('primary', 'sendgrid_email');
        const fallbackConnector = createConnector('fallback', 'smtp');
        primaryConnector.execute.mockResolvedValueOnce(verdict);
        const handleSpy = jest.fn().mockReturnValue(ConnectorFailureAction.PROPAGATE);
        const handler = createHandler('spy_handler', handleSpy);
        const service = createService(
          [primaryConnector, fallbackConnector] as ConnectorAdapterCollection,
          { errorHandlers: [handler] },
        );

        const primary = declaration({
          name: 'primary_email',
          id: 'sendgrid_email',
          type: 'custom',
          order: 1,
          errorHandler: 'spy_handler',
          fieldMapping: {},
          fallbacks: [
            declaration({
              name: 'backup_email',
              id: 'smtp',
              type: 'custom',
              order: 1,
              fieldMapping: {},
            }),
          ],
        });

        const result = await service.execute(
          [primary],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        );

        expect(result).toEqual(verdict);
        expect(handleSpy).not.toHaveBeenCalled();
        expect(fallbackConnector.execute).not.toHaveBeenCalled();
      },
    );

    it("parks on the fallback after an async primary throws, keeping the primary's order", async () => {
      const primaryConnector = createConnector('primary', 'sendgrid_email', true);
      const fallbackConnector = createConnector('fallback', 'smtp', true);
      primaryConnector.execute.mockRejectedValueOnce(new Error('boom'));
      fallbackConnector.execute.mockResolvedValueOnce(ConnectorExecutionResult.accepted());
      const service = createService([
        primaryConnector,
        fallbackConnector,
      ] as ConnectorAdapterCollection);

      const primary = declaration({
        name: 'primary_email',
        id: 'sendgrid_email',
        type: 'custom',
        order: 5,
        async: true,
        fieldMapping: {},
        fallbacks: [
          declaration({
            name: 'backup_email',
            id: 'smtp',
            type: 'custom',
            order: 5,
            async: true,
            fieldMapping: {},
          }),
        ],
      });

      const result = await service.execute(
        [primary],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      );

      expect(result).toEqual(
        ConnectorExecutionResult.pending({
          connectorName: 'backup_email',
          connectorId: 'smtp',
          connectorOrder: 5,
        }),
      );
    });

    it('propagates when the handler falls back to an unregistered connector id', async () => {
      const primaryConnector = createConnector('primary', 'sendgrid_email');
      primaryConnector.execute.mockRejectedValueOnce(new Error('boom'));
      const service = createService([primaryConnector] as ConnectorAdapterCollection);

      const primary = declaration({
        name: 'primary_email',
        id: 'sendgrid_email',
        type: 'custom',
        order: 1,
        fieldMapping: {},
        fallbacks: [
          declaration({
            name: 'backup',
            id: 'unregistered_smtp',
            type: 'custom',
            order: 1,
            fieldMapping: {},
          }),
        ],
      });

      await expect(
        service.execute([primary], {}, { onboardingId: 'onboarding-123', stepName: 'step' }),
      ).rejects.toBeInstanceOf(ConnectorAdapterNotRegisteredError);
    });

    it('propagates when the fallback payload maps a field missing from the context', async () => {
      const primaryConnector = createConnector('primary', 'sendgrid_email');
      const fallbackConnector = createConnector('fallback', 'smtp');
      primaryConnector.execute.mockRejectedValueOnce(new Error('boom'));
      const service = createService([
        primaryConnector,
        fallbackConnector,
      ] as ConnectorAdapterCollection);

      const primary = declaration({
        name: 'primary_email',
        id: 'sendgrid_email',
        type: 'custom',
        order: 1,
        fieldMapping: {},
        fallbacks: [
          declaration({
            name: 'backup',
            id: 'smtp',
            type: 'custom',
            order: 1,
            fieldMapping: { recipient: 'missingField' },
          }),
        ],
      });

      await expect(
        service.execute([primary], {}, { onboardingId: 'onboarding-123', stepName: 'step' }),
      ).rejects.toBeInstanceOf(ConnectorPayloadFieldNotFoundError);
    });
  });

  describe('validateDeclarations for error handlers and fallbacks', () => {
    it('rejects an unknown errorHandler', () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      const service = createService([connector] as ConnectorAdapterCollection);

      expect(() =>
        service.validateDeclarations([
          declaration({
            name: 'declaration_one',
            id: 'mock_kyc_1',
            order: 1,
            errorHandler: 'not_registered',
            fieldMapping: {},
          }),
        ]),
      ).toThrow(ConnectorErrorHandlerNotRegisteredError);
    });

    it('rejects a fallback whose adapter declares a different type than the fallback declares', () => {
      const primaryConnector = createConnector('primary', 'sendgrid_email');
      const fallbackConnector = {
        ...createConnector('fallback', 'smtp'),
        type: 'kyc',
      } as ConnectorAdapter;
      const service = createService([
        primaryConnector,
        fallbackConnector,
      ] as ConnectorAdapterCollection);

      expect(() =>
        service.validateDeclarations([
          declaration({
            name: 'primary_email',
            id: 'sendgrid_email',
            type: 'custom',
            order: 1,
            fieldMapping: {},
            fallbacks: [
              declaration({
                name: 'backup',
                id: 'smtp',
                type: 'custom',
                order: 1,
                fieldMapping: {},
              }),
            ],
          }),
        ]),
      ).toThrow(ConnectorTypeMismatchError);
    });

    it('rejects a fallback declaring async when its adapter does not support async callbacks', () => {
      const primaryConnector = createConnector('primary', 'sendgrid_email', true);
      const fallbackConnector = createConnector('fallback', 'smtp', false);
      const service = createService([
        primaryConnector,
        fallbackConnector,
      ] as ConnectorAdapterCollection);

      expect(() =>
        service.validateDeclarations([
          declaration({
            name: 'primary_email',
            id: 'sendgrid_email',
            type: 'custom',
            order: 1,
            async: true,
            fieldMapping: {},
            fallbacks: [
              declaration({
                name: 'backup',
                id: 'smtp',
                type: 'custom',
                order: 1,
                async: true,
                fieldMapping: {},
              }),
            ],
          }),
        ]),
      ).toThrow(
        'Async callback is not supported for fallback connector id=smtp and connector name=backup',
      );
    });
  });

  describe('audit trail', () => {
    it('records connector.failure_retried then connector.failure_fell_back, in order, for a retry followed by a fallback', async () => {
      const primaryConnector = createConnector('primary', 'sendgrid_email');
      const fallbackConnector = createConnector('fallback', 'smtp');
      primaryConnector.execute.mockRejectedValue(new ServiceUnavailableException('unavailable'));
      fallbackConnector.execute.mockResolvedValueOnce(ConnectorExecutionResult.accepted());
      const auditService = createAuditServiceMock();
      const service = createService(
        [primaryConnector, fallbackConnector] as ConnectorAdapterCollection,
        { auditService },
      );

      const primary = declaration({
        name: 'primary_email',
        id: 'sendgrid_email',
        type: 'custom',
        order: 1,
        errorHandler: 'retry_then_fallback',
        fieldMapping: {},
        fallbacks: [
          declaration({
            name: 'backup_email',
            id: 'smtp',
            type: 'custom',
            order: 1,
            fieldMapping: {},
          }),
        ],
      });

      await service.execute([primary], {}, { onboardingId: 'onboarding-123', stepName: 'step' });
      await service.flushConnectorFailureAudits();

      expect(auditService.logConnectorFailure).toHaveBeenCalledTimes(2);
      const calls = auditService.logConnectorFailure.mock.calls as [
        DataSource,
        ConnectorFailureAuditInput,
      ][];

      expect(calls[0][1].action).toBe('connector.failure_retried');
      expect(calls[0][1].metadata.connectorId).toBe('sendgrid_email');

      expect(calls[1][1].action).toBe('connector.failure_fell_back');
      expect(calls[1][1].metadata.connectorId).toBe('sendgrid_email');
      expect(calls[1][1].metadata.fallbackConnectorId).toBe('smtp');
      expect(calls[1][1].metadata.fallbackConnectorName).toBe('backup_email');
    });

    it('records connector.failure_propagated with override=attempts_exhausted when the retry cap is hit', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      const error = new Error('always fails');
      connector.execute.mockRejectedValue(error);
      const alwaysRetry = createHandler('always_retry', () => ConnectorFailureAction.RETRY);
      const auditService = createAuditServiceMock();
      const service = createService([connector] as ConnectorAdapterCollection, {
        errorHandlers: [alwaysRetry],
        auditService,
      });

      await expect(
        service.execute(
          [
            declaration({
              name: 'declaration_one',
              id: 'mock_kyc_1',
              order: 1,
              errorHandler: 'always_retry',
              fieldMapping: {},
            }),
          ],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        ),
      ).rejects.toBe(error);
      await service.flushConnectorFailureAudits();

      const calls = auditService.logConnectorFailure.mock.calls as [
        DataSource,
        ConnectorFailureAuditInput,
      ][];

      expect(calls).toHaveLength(2);
      expect(calls[0][1].action).toBe('connector.failure_retried');
      expect(calls[1][1].action).toBe('connector.failure_propagated');
      expect(calls[1][1].metadata.override).toBe('attempts_exhausted');
    });

    it('stamps every decision as it is made, so the trail reads back in decision order', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      connector.execute.mockRejectedValue(new Error('always fails'));
      const alwaysRetry = createHandler('always_retry', () => ConnectorFailureAction.RETRY);
      const auditService = createAuditServiceMock();
      const service = createService([connector] as ConnectorAdapterCollection, {
        errorHandlers: [alwaysRetry],
        auditService,
      });

      await expect(
        service.execute(
          [
            declaration({
              name: 'declaration_one',
              id: 'mock_kyc_1',
              order: 1,
              errorHandler: 'always_retry',
              fieldMapping: {},
              // No wait between the attempts, so both decisions fall in one millisecond - the
              // case where `occurred_at` alone cannot separate them.
              retry: { maxAttempts: 3, delayMs: 0 },
            }),
          ],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        ),
      ).rejects.toThrow('always fails');
      await service.flushConnectorFailureAudits();

      const stamps = (
        auditService.logConnectorFailure.mock.calls as [DataSource, ConnectorFailureAuditInput][]
      ).map(([, input]) => input.stamp);

      expect(stamps).toHaveLength(3);
      // Read back as `occurred_at, id`, so that pair must rise with each decision. The writes
      // themselves run concurrently and settle in any order; only these stamps fix the trail.
      const ordering = stamps.map((stamp) => [stamp.occurredAt.getTime(), stamp.id] as const);
      expect(ordering).toEqual(
        [...ordering].sort(([aTime, aId], [bTime, bId]) =>
          aTime === bTime ? aId.localeCompare(bId) : aTime - bTime,
        ),
      );
      expect(new Set(stamps.map((stamp) => stamp.id)).size).toBe(3);
    });

    it('records connector.failure_ignored exactly once for a continued decision', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      connector.execute.mockRejectedValueOnce(new Error('boom'));
      const auditService = createAuditServiceMock();
      const service = createService([connector] as ConnectorAdapterCollection, { auditService });

      await service.execute(
        [
          declaration({
            name: 'declaration_one',
            id: 'mock_kyc_1',
            order: 1,
            errorHandler: 'continue_on_error',
            fieldMapping: {},
          }),
        ],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      );
      await service.flushConnectorFailureAudits();

      expect(auditService.logConnectorFailure).toHaveBeenCalledTimes(1);
      const [, input] = auditService.logConnectorFailure.mock.calls[0] as [
        DataSource,
        ConnectorFailureAuditInput,
      ];

      expect(input.action).toBe('connector.failure_ignored');
      expect(input.metadata.connectorId).toBe('mock_kyc_1');
      expect(input.metadata.fallbackConnectorId).toBeUndefined();
    });

    it('records connector.failure_propagated exactly once for a genuine propagate decision', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      connector.execute.mockRejectedValueOnce(new Error('boom'));
      const propagateHandler = createHandler(
        'always_propagate',
        () => ConnectorFailureAction.PROPAGATE,
      );
      const auditService = createAuditServiceMock();
      const service = createService([connector] as ConnectorAdapterCollection, {
        errorHandlers: [propagateHandler],
        auditService,
      });

      await expect(
        service.execute(
          [
            declaration({
              name: 'declaration_one',
              id: 'mock_kyc_1',
              order: 1,
              errorHandler: 'always_propagate',
              fieldMapping: {},
            }),
          ],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        ),
      ).rejects.toThrow('boom');
      await service.flushConnectorFailureAudits();

      expect(auditService.logConnectorFailure).toHaveBeenCalledTimes(1);
      const [, input] = auditService.logConnectorFailure.mock.calls[0] as [
        DataSource,
        ConnectorFailureAuditInput,
      ];

      expect(input.action).toBe('connector.failure_propagated');
      expect(input.metadata.override).toBeUndefined();
    });

    it('records errorName without the error message', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');

      class ProviderUnavailableError extends Error {
        constructor() {
          super('secret endpoint https://internal.example.com failed');
          this.name = 'ProviderUnavailableError';
        }
      }

      const error = new ProviderUnavailableError();
      connector.execute.mockRejectedValueOnce(error);
      const propagateHandler = createHandler(
        'always_propagate',
        () => ConnectorFailureAction.PROPAGATE,
      );
      const auditService = createAuditServiceMock();
      const service = createService([connector] as ConnectorAdapterCollection, {
        errorHandlers: [propagateHandler],
        auditService,
      });

      await expect(
        service.execute(
          [
            declaration({
              name: 'declaration_one',
              id: 'mock_kyc_1',
              order: 1,
              errorHandler: 'always_propagate',
              fieldMapping: {},
            }),
          ],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        ),
      ).rejects.toBe(error);
      await service.flushConnectorFailureAudits();

      const [, input] = auditService.logConnectorFailure.mock.calls[0] as [
        DataSource,
        ConnectorFailureAuditInput,
      ];

      expect(input.metadata.errorName).toBe('ProviderUnavailableError');
      expect(JSON.stringify(input.metadata)).not.toContain('secret endpoint');
    });

    it('carries on with the handler decision when the audit write rejects', async () => {
      const primaryConnector = createConnector('primary', 'sendgrid_email');
      const fallbackConnector = createConnector('fallback', 'smtp');
      primaryConnector.execute.mockRejectedValueOnce(new Error('boom'));
      fallbackConnector.execute.mockResolvedValueOnce(ConnectorExecutionResult.accepted());
      const auditService = createAuditServiceMock();
      auditService.logConnectorFailure.mockRejectedValueOnce(new Error('audit down'));
      const service = createService(
        [primaryConnector, fallbackConnector] as ConnectorAdapterCollection,
        { auditService },
      );

      const primary = declaration({
        name: 'primary_email',
        id: 'sendgrid_email',
        type: 'custom',
        order: 1,
        fieldMapping: {},
        fallbacks: [
          declaration({
            name: 'backup_email',
            id: 'smtp',
            type: 'custom',
            order: 1,
            fieldMapping: {},
          }),
        ],
      });

      const result = await service.execute(
        [primary],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      );

      expect(result).toEqual(ConnectorExecutionResult.accepted());
      expect(fallbackConnector.execute).toHaveBeenCalledTimes(1);

      // The rejection is handled here, deterministically, rather than left to resolve on its own
      // after the test ends — proving it neither changes the outcome above nor escapes as an
      // unhandled rejection.
      await expect(service.flushConnectorFailureAudits()).resolves.toBeUndefined();
      expect(auditService.logConnectorFailure).toHaveBeenCalledTimes(1);
    });

    it('does not wait for the audit write before resolving, proving the pooled-connection deadlock fix', async () => {
      const primaryConnector = createConnector('primary', 'sendgrid_email');
      const fallbackConnector = createConnector('fallback', 'smtp');
      primaryConnector.execute.mockRejectedValueOnce(new Error('boom'));
      fallbackConnector.execute.mockResolvedValueOnce(ConnectorExecutionResult.accepted());
      const auditGate = createDeferred<unknown>();
      const auditService = createAuditServiceMock();
      auditService.logConnectorFailure.mockReturnValueOnce(auditGate.promise);
      const service = createService(
        [primaryConnector, fallbackConnector] as ConnectorAdapterCollection,
        { auditService },
      );

      const primary = declaration({
        name: 'primary_email',
        id: 'sendgrid_email',
        type: 'custom',
        order: 1,
        fieldMapping: {},
        fallbacks: [
          declaration({
            name: 'backup_email',
            id: 'smtp',
            type: 'custom',
            order: 1,
            fieldMapping: {},
          }),
        ],
      });

      // `auditGate.promise` is still pending at this point — a real second pool acquire that
      // would never settle if the connector chain awaited it, exactly Finding 1's scenario. That
      // `execute()` resolves anyway is the fix.
      const result = await service.execute(
        [primary],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      );

      expect(result).toEqual(ConnectorExecutionResult.accepted());

      auditGate.resolve(undefined);
      await service.flushConnectorFailureAudits();

      expect(auditService.logConnectorFailure).toHaveBeenCalledTimes(1);
    });

    it('records connector.failure_propagated with override=fallback_unavailable when a handler falls back to nothing', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      const error = new Error('boom');
      connector.execute.mockRejectedValueOnce(error);
      const fallbackToNothing = createHandler(
        'fallback_to_nothing',
        () => ConnectorFailureAction.FALLBACK,
      );
      const auditService = createAuditServiceMock();
      const service = createService([connector] as ConnectorAdapterCollection, {
        errorHandlers: [fallbackToNothing],
        auditService,
      });

      await expect(
        service.execute(
          [
            declaration({
              name: 'declaration_one',
              id: 'mock_kyc_1',
              order: 1,
              errorHandler: 'fallback_to_nothing',
              fieldMapping: {},
            }),
          ],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        ),
      ).rejects.toBe(error);
      await service.flushConnectorFailureAudits();

      expect(auditService.logConnectorFailure).toHaveBeenCalledTimes(1);
      const [, input] = auditService.logConnectorFailure.mock.calls[0] as [
        DataSource,
        ConnectorFailureAuditInput,
      ];

      expect(input.action).toBe('connector.failure_propagated');
      expect(input.metadata.override).toBe('fallback_unavailable');
    });

    it('propagates and records an override when a handler returns an out-of-contract action', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      const error = new Error('boom');
      connector.execute.mockRejectedValueOnce(error);
      const rogueHandler = createHandler(
        'rogue_handler',
        () => 'retry_forever' as unknown as ConnectorFailureAction,
      );
      const auditService = createAuditServiceMock();
      const loggerErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const service = createService([connector] as ConnectorAdapterCollection, {
        errorHandlers: [rogueHandler],
        auditService,
      });

      await expect(
        service.execute(
          [
            declaration({
              name: 'declaration_one',
              id: 'mock_kyc_1',
              order: 1,
              errorHandler: 'rogue_handler',
              fieldMapping: {},
            }),
          ],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        ),
      ).rejects.toBe(error);
      await service.flushConnectorFailureAudits();

      expect(auditService.logConnectorFailure).toHaveBeenCalledTimes(1);
      const [, input] = auditService.logConnectorFailure.mock.calls[0] as [
        DataSource,
        ConnectorFailureAuditInput,
      ];

      expect(input.action).toBe('connector.failure_propagated');
      expect(input.metadata.override).toBe('invalid_handler_action');
      expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('rogue_handler'));

      loggerErrorSpy.mockRestore();
    });

    it('drops a scheduled audit write once the in-flight cap is reached rather than queueing it', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      const error = new Error('boom');
      connector.execute.mockRejectedValue(error);
      // Never settles, standing in for a write blocked on a starved pool — the condition the cap
      // exists for. Resolved at the end so the test leaves nothing pending.
      const stuckAuditWrite = createDeferred<unknown>();
      const auditService = createAuditServiceMock();
      auditService.logConnectorFailure.mockReturnValue(stuckAuditWrite.promise);
      const loggerErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const service = createService([connector] as ConnectorAdapterCollection, { auditService });
      const primary = declaration({
        name: 'declaration_one',
        id: 'mock_kyc_1',
        order: 1,
        fieldMapping: {},
      });

      for (let submitted = 0; submitted <= MAX_PENDING_CONNECTOR_FAILURE_AUDITS; submitted += 1) {
        await expect(
          service.execute([primary], {}, { onboardingId: 'onboarding-123', stepName: 'step' }),
        ).rejects.toBe(error);
      }

      expect(auditService.logConnectorFailure).toHaveBeenCalledTimes(
        MAX_PENDING_CONNECTOR_FAILURE_AUDITS,
      );
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('writes are already in flight'),
      );

      stuckAuditWrite.resolve(undefined);
      await service.flushConnectorFailureAudits();
      loggerErrorSpy.mockRestore();
    });

    it('drains scheduled audit writes on shutdown so a decision is not lost with the process', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      const error = new Error('boom');
      connector.execute.mockRejectedValueOnce(error);
      const auditWrite = createDeferred<unknown>();
      const auditService = createAuditServiceMock();
      auditService.logConnectorFailure.mockReturnValueOnce(auditWrite.promise);
      const service = createService([connector] as ConnectorAdapterCollection, { auditService });

      await expect(
        service.execute(
          [declaration({ name: 'declaration_one', id: 'mock_kyc_1', order: 1, fieldMapping: {} })],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        ),
      ).rejects.toBe(error);

      let settled = false;
      auditWrite.promise.then(() => {
        settled = true;
      });
      auditWrite.resolve(undefined);
      await service.onModuleDestroy();

      expect(settled).toBe(true);
      expect(auditService.logConnectorFailure).toHaveBeenCalledTimes(1);
    });

    it('gives up on a stuck audit write rather than holding shutdown open', async () => {
      jest.useFakeTimers();

      try {
        const connector = createConnector('adapter_one', 'mock_kyc_1');
        const error = new Error('boom');
        connector.execute.mockRejectedValueOnce(error);
        const stuckAuditWrite = createDeferred<unknown>();
        const auditService = createAuditServiceMock();
        auditService.logConnectorFailure.mockReturnValueOnce(stuckAuditWrite.promise);
        const service = createService([connector] as ConnectorAdapterCollection, { auditService });

        await expect(
          service.execute(
            [
              declaration({
                name: 'declaration_one',
                id: 'mock_kyc_1',
                order: 1,
                fieldMapping: {},
              }),
            ],
            {},
            { onboardingId: 'onboarding-123', stepName: 'step' },
          ),
        ).rejects.toBe(error);

        const shutdown = service.onModuleDestroy();
        jest.runOnlyPendingTimers();

        await expect(shutdown).resolves.toBeUndefined();

        stuckAuditWrite.resolve(undefined);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('connector.execution_unavailable for pre-chain failures', () => {
    it('records connector.execution_unavailable and propagates the error unchanged when no adapter is registered for the id', async () => {
      const auditService = createAuditServiceMock();
      const service = createService([] as ConnectorAdapterCollection, { auditService });

      await expect(
        service.execute(
          [
            declaration({
              name: 'declaration_one',
              id: 'not_registered',
              order: 1,
              fieldMapping: {},
            }),
          ],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        ),
      ).rejects.toBeInstanceOf(ConnectorAdapterNotRegisteredError);
      await service.flushConnectorFailureAudits();

      expect(auditService.logConnectorOutcome).toHaveBeenCalledTimes(1);
      const [, input] = auditService.logConnectorOutcome.mock.calls[0] as [
        DataSource,
        ConnectorOutcomeAuditInput,
      ];

      expect(input.action).toBe('connector.execution_unavailable');
      expect(input.resourceId).toBe('onboarding-123');
      expect(input.metadata).toEqual({
        stepName: 'step',
        connectorId: 'not_registered',
        connectorName: 'declaration_one',
        connectorOrder: 1,
        errorName: 'ConnectorAdapterNotRegisteredError',
      });
      // The handler chain never ran, so no `connector.failure_*` row exists for this failure.
      expect(auditService.logConnectorFailure).not.toHaveBeenCalled();
    });

    it('records connector.execution_unavailable when a mapped payload field is missing from context', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      const auditService = createAuditServiceMock();
      const service = createService([connector] as ConnectorAdapterCollection, { auditService });

      await expect(
        service.execute(
          [
            declaration({
              name: 'declaration_one',
              id: 'mock_kyc_1',
              order: 1,
              fieldMapping: { missing: 'missingField' },
            }),
          ],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        ),
      ).rejects.toBeInstanceOf(ConnectorPayloadFieldNotFoundError);
      await service.flushConnectorFailureAudits();

      expect(auditService.logConnectorOutcome).toHaveBeenCalledTimes(1);
      const [, input] = auditService.logConnectorOutcome.mock.calls[0] as [
        DataSource,
        ConnectorOutcomeAuditInput,
      ];

      expect(input.action).toBe('connector.execution_unavailable');
      expect(input.metadata.errorName).toBe('ConnectorPayloadFieldNotFoundError');
      expect(connector.execute).not.toHaveBeenCalled();
      expect(auditService.logConnectorFailure).not.toHaveBeenCalled();
    });

    it('records connector.execution_unavailable when the declared error handler is not registered', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      const auditService = createAuditServiceMock();
      const service = createService([connector] as ConnectorAdapterCollection, { auditService });

      await expect(
        service.execute(
          [
            declaration({
              name: 'declaration_one',
              id: 'mock_kyc_1',
              order: 1,
              errorHandler: 'not_registered',
              fieldMapping: {},
            }),
          ],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        ),
      ).rejects.toBeInstanceOf(ConnectorErrorHandlerNotRegisteredError);
      await service.flushConnectorFailureAudits();

      expect(auditService.logConnectorOutcome).toHaveBeenCalledTimes(1);
      const [, input] = auditService.logConnectorOutcome.mock.calls[0] as [
        DataSource,
        ConnectorOutcomeAuditInput,
      ];

      expect(input.action).toBe('connector.execution_unavailable');
      expect(input.metadata.errorName).toBe('ConnectorErrorHandlerNotRegisteredError');
      expect(connector.execute).not.toHaveBeenCalled();
      expect(auditService.logConnectorFailure).not.toHaveBeenCalled();
    });

    it('records connector.execution_unavailable when an async declaration targets a non-callback-capable adapter', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1', false);
      const auditService = createAuditServiceMock();
      const service = createService([connector] as ConnectorAdapterCollection, { auditService });

      await expect(
        service.execute(
          [
            declaration({
              name: 'declaration_one',
              id: 'mock_kyc_1',
              order: 1,
              async: true,
              fieldMapping: {},
            }),
          ],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        ),
      ).rejects.toThrow(
        'Async callback is not supported for connector id=mock_kyc_1 and connector name=declaration_one',
      );
      await service.flushConnectorFailureAudits();

      expect(auditService.logConnectorOutcome).toHaveBeenCalledTimes(1);
      const [, input] = auditService.logConnectorOutcome.mock.calls[0] as [
        DataSource,
        ConnectorOutcomeAuditInput,
      ];

      expect(input.action).toBe('connector.execution_unavailable');
      expect(input.metadata.errorName).toBe('Error');
      expect(connector.execute).not.toHaveBeenCalled();
      expect(auditService.logConnectorFailure).not.toHaveBeenCalled();
    });

    it('shares the connector-failure pending-set cap, so a pre-chain failure is dropped once it is full rather than queued separately', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      const error = new Error('boom');
      connector.execute.mockRejectedValue(error);
      // Never settles, standing in for a write blocked on a starved pool - the condition the cap
      // exists for. Resolved at the end so the test leaves nothing pending.
      const stuckAuditWrite = createDeferred<unknown>();
      const auditService = createAuditServiceMock();
      auditService.logConnectorFailure.mockReturnValue(stuckAuditWrite.promise);
      const loggerErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const service = createService([connector] as ConnectorAdapterCollection, { auditService });
      const primary = declaration({
        name: 'declaration_one',
        id: 'mock_kyc_1',
        order: 1,
        fieldMapping: {},
      });

      for (let submitted = 0; submitted < MAX_PENDING_CONNECTOR_FAILURE_AUDITS; submitted += 1) {
        await expect(
          service.execute([primary], {}, { onboardingId: 'onboarding-123', stepName: 'step' }),
        ).rejects.toBe(error);
      }

      expect(auditService.logConnectorFailure).toHaveBeenCalledTimes(
        MAX_PENDING_CONNECTOR_FAILURE_AUDITS,
      );

      // The connector-failure family alone has already filled the shared cap, so this unrelated
      // pre-chain failure - a different family entirely - is dropped rather than queued past it.
      await expect(
        service.execute(
          [
            declaration({
              name: 'declaration_two',
              id: 'not_registered',
              order: 1,
              fieldMapping: {},
            }),
          ],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        ),
      ).rejects.toBeInstanceOf(ConnectorAdapterNotRegisteredError);

      expect(auditService.logConnectorOutcome).not.toHaveBeenCalled();
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('writes are already in flight'),
      );

      stuckAuditWrite.resolve(undefined);
      await service.flushConnectorFailureAudits();
      loggerErrorSpy.mockRestore();
    });
  });

  describe('connector.result_rejected and connector.result_invalid_data for non-accepted adapter results', () => {
    it('records connector.result_rejected and returns the rejected result unchanged', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      connector.execute.mockResolvedValueOnce(
        ConnectorExecutionResult.rejected('CONNECTOR_REJECTED'),
      );
      const auditService = createAuditServiceMock();
      const service = createService([connector] as ConnectorAdapterCollection, { auditService });

      await expect(
        service.execute(
          [declaration({ name: 'declaration_one', id: 'mock_kyc_1', order: 1, fieldMapping: {} })],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        ),
      ).resolves.toEqual(ConnectorExecutionResult.rejected('CONNECTOR_REJECTED'));
      await service.flushConnectorFailureAudits();

      expect(auditService.logConnectorOutcome).toHaveBeenCalledTimes(1);
      const [, input] = auditService.logConnectorOutcome.mock.calls[0] as [
        DataSource,
        ConnectorOutcomeAuditInput,
      ];

      expect(input.action).toBe('connector.result_rejected');
      expect(input.resourceId).toBe('onboarding-123');
      expect(input.metadata).toEqual({
        stepName: 'step',
        connectorId: 'mock_kyc_1',
        connectorName: 'declaration_one',
        connectorOrder: 1,
        reason: 'CONNECTOR_REJECTED',
      });
    });

    it('records connector.result_invalid_data and returns the invalid-data result unchanged', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      connector.execute.mockResolvedValueOnce(
        ConnectorExecutionResult.invalidData({ recipient: ['INVALID'] }),
      );
      const auditService = createAuditServiceMock();
      const service = createService([connector] as ConnectorAdapterCollection, { auditService });

      await expect(
        service.execute(
          [declaration({ name: 'declaration_one', id: 'mock_kyc_1', order: 1, fieldMapping: {} })],
          {},
          { onboardingId: 'onboarding-123', stepName: 'step' },
        ),
      ).resolves.toEqual(ConnectorExecutionResult.invalidData({ recipient: ['INVALID'] }));
      await service.flushConnectorFailureAudits();

      expect(auditService.logConnectorOutcome).toHaveBeenCalledTimes(1);
      const [, input] = auditService.logConnectorOutcome.mock.calls[0] as [
        DataSource,
        ConnectorOutcomeAuditInput,
      ];

      expect(input.action).toBe('connector.result_invalid_data');
      expect(input.metadata).toEqual({
        stepName: 'step',
        connectorId: 'mock_kyc_1',
        connectorName: 'declaration_one',
        connectorOrder: 1,
        fieldErrors: { recipient: ['INVALID'] },
      });
    });

    it('does not audit an accepted or a plain invalid result', async () => {
      const connector = createConnector('adapter_one', 'mock_kyc_1');
      connector.execute.mockResolvedValueOnce(ConnectorExecutionResult.invalid());
      const auditService = createAuditServiceMock();
      const service = createService([connector] as ConnectorAdapterCollection, { auditService });

      await service.execute(
        [declaration({ name: 'declaration_one', id: 'mock_kyc_1', order: 1, fieldMapping: {} })],
        {},
        { onboardingId: 'onboarding-123', stepName: 'step' },
      );
      await service.flushConnectorFailureAudits();

      expect(auditService.logConnectorOutcome).not.toHaveBeenCalled();
    });
  });
});
