import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import type { ConnectorAdapter, ConnectorAdapterCollection } from './ports/connector-adapter.port';
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
  verify: jest.fn().mockResolvedValue(true),
});

describe('WorkflowConnectorExecutorService', () => {
  it('routes each declaration by type only and preserves fresh payloads', async () => {
    const firstConnector = createConnector('adapter_one', 'mock_kyc_1');
    const secondConnector = createConnector('adapter_two', 'mock_kyc_2');
    const service = new WorkflowConnectorExecutorService([
      secondConnector,
      firstConnector,
    ] as ConnectorAdapterCollection);
    const context = { email: 'person@example.com', acceptedTerms: true };
    const declarations: readonly NormalizedWorkflowConnectorDeclaration[] = [
      {
        name: 'declaration_two',
        type: 'mock_kyc_2',
        order: 2,
        fieldMapping: { acceptedTerms: 'acceptedTerms' },
      },
      {
        name: 'declaration_one',
        type: 'mock_kyc_1',
        order: 1,
        fieldMapping: { email: 'email' },
      },
    ];

    const execution = { onboardingId: 'onboarding-123', stepName: 'collect_email' };

    await service.execute(declarations, context, execution);

    expect(firstConnector.verify).toHaveBeenCalledWith({
      execution,
      context: { email: 'person@example.com', acceptedTerms: true },
      payload: { email: 'person@example.com' },
      payloadFieldSources: { email: 'email' },
    });
    expect(secondConnector.verify).toHaveBeenCalledWith({
      execution,
      context: { email: 'person@example.com', acceptedTerms: true },
      payload: { acceptedTerms: true },
      payloadFieldSources: { acceptedTerms: 'acceptedTerms' },
    });
    expect(firstConnector.verify).toHaveBeenCalledTimes(1);
    expect(secondConnector.verify).toHaveBeenCalledTimes(1);
    expect(context).toEqual({ email: 'person@example.com', acceptedTerms: true });

    const firstInput = firstConnector.verify.mock.calls[0][0] as {
      execution: { onboardingId: string; stepName: string };
      context: Record<string, unknown>;
      payload: Record<string, unknown>;
      payloadFieldSources: Record<string, string>;
    };
    expect(firstInput.execution).not.toBe(execution);
    expect(firstInput.context).not.toBe(context);
    expect(firstInput.payload).not.toBe(context);
    expect(firstInput.payloadFieldSources).not.toBe(context);
  });

  it('throws when there is no adapter match for the declaration type', async () => {
    const firstConnector = createConnector('tsh_kyc_1', 'mock_kyc_1');
    const service = new WorkflowConnectorExecutorService([
      firstConnector,
    ] as ConnectorAdapterCollection);

    await expect(
      service.execute(
        [
          {
            name: 'tsh_kyc_2',
            type: 'unknown_type',
            order: 1,
            fieldMapping: { email: 'email' },
          },
        ],
        { email: 'person@example.com' },
        { onboardingId: 'onboarding-123', stepName: 'collect_email' },
      ),
    ).rejects.toThrow('Connector adapter not registered for type=unknown_type');
    expect(firstConnector.verify).not.toHaveBeenCalled();
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
        [
          {
            name: 'any_name',
            type: 'mock_kyc_1',
            order: 1,
            fieldMapping: { email: 'email' },
          },
        ],
        { email: 'person@example.com' },
        { onboardingId: 'onboarding-123', stepName: 'collect_email' },
      ),
    ).rejects.toThrow('Duplicate connector adapter registration for type=mock_kyc_1');
    expect(firstConnector.verify).not.toHaveBeenCalled();
    expect(duplicateConnector.verify).not.toHaveBeenCalled();
  });

  it('ignores declaration name when declaration type matches exactly one adapter', async () => {
    const firstConnector = createConnector('adapter_one', 'mock_kyc_1');
    const secondConnector = createConnector('adapter_two', 'mock_kyc_2');
    const service = new WorkflowConnectorExecutorService([
      secondConnector,
      firstConnector,
    ] as ConnectorAdapterCollection);

    await service.execute(
      [
        {
          name: 'name_that_does_not_match_any_adapter',
          type: 'mock_kyc_1',
          order: 1,
          fieldMapping: { email: 'email' },
        },
      ],
      { email: 'person@example.com' },
      { onboardingId: 'onboarding-123', stepName: 'collect_email' },
    );

    expect(firstConnector.verify).toHaveBeenCalledWith({
      execution: { onboardingId: 'onboarding-123', stepName: 'collect_email' },
      context: { email: 'person@example.com' },
      payload: { email: 'person@example.com' },
      payloadFieldSources: { email: 'email' },
    });
    expect(firstConnector.verify).toHaveBeenCalledTimes(1);
    expect(secondConnector.verify).not.toHaveBeenCalled();
  });

  it('executes declarations in ascending order even when the input order differs', async () => {
    const firstConnector = createConnector('adapter_one', 'mock_kyc_1');
    const secondConnector = createConnector('adapter_two', 'mock_kyc_2');
    const service = new WorkflowConnectorExecutorService([
      secondConnector,
      firstConnector,
    ] as ConnectorAdapterCollection);
    const calls: string[] = [];

    firstConnector.verify.mockImplementation(async () => {
      calls.push('first');
      return true;
    });
    secondConnector.verify.mockImplementation(async () => {
      calls.push('second');
      return true;
    });

    await service.execute(
      [
        {
          name: 'any_name_two',
          type: 'mock_kyc_2',
          order: 2,
          fieldMapping: { email: 'email' },
        },
        {
          name: 'any_name_one',
          type: 'mock_kyc_1',
          order: 1,
          fieldMapping: { email: 'email' },
        },
      ],
      { email: 'person@example.com' },
      { onboardingId: 'onboarding-123', stepName: 'collect_email' },
    );

    expect(calls).toEqual(['first', 'second']);
  });

  it('does not invoke the next connector until the previous promise resolves', async () => {
    const firstConnector = createConnector('adapter_one', 'mock_kyc_1');
    const secondConnector = createConnector('adapter_two', 'mock_kyc_2');
    const service = new WorkflowConnectorExecutorService([
      secondConnector,
      firstConnector,
    ] as ConnectorAdapterCollection);
    const firstGate = createDeferred<boolean>();
    const secondGate = createDeferred<boolean>();

    firstConnector.verify.mockImplementationOnce(() => firstGate.promise);
    secondConnector.verify.mockImplementationOnce(() => secondGate.promise);

    const execution = service.execute(
      [
        {
          name: 'decl_two',
          type: 'mock_kyc_2',
          order: 2,
          fieldMapping: { email: 'email' },
        },
        {
          name: 'decl_one',
          type: 'mock_kyc_1',
          order: 1,
          fieldMapping: { email: 'email' },
        },
      ],
      { email: 'person@example.com' },
      { onboardingId: 'onboarding-123', stepName: 'collect_email' },
    );

    await Promise.resolve();
    expect(firstConnector.verify).toHaveBeenCalledTimes(1);
    expect(secondConnector.verify).not.toHaveBeenCalled();

    firstGate.resolve(true);
    await Promise.resolve();
    expect(secondConnector.verify).toHaveBeenCalledTimes(1);

    secondGate.resolve(true);
    await execution;
  });

  it('supports cross-step mapping by building payload from the full runtime context', async () => {
    const secondConnector = createConnector('adapter_two', 'mock_kyc_2');
    const service = new WorkflowConnectorExecutorService([
      secondConnector,
    ] as ConnectorAdapterCollection);

    await service.execute(
      [
        {
          name: 'decl_two',
          type: 'mock_kyc_2',
          order: 1,
          fieldMapping: { email: 'email', acceptedTerms: 'acceptedTerms' },
        },
      ],
      { email: 'person@example.com', acceptedTerms: true },
      { onboardingId: 'onboarding-123', stepName: 'collect_email' },
    );

    expect(secondConnector.verify).toHaveBeenCalledWith({
      execution: { onboardingId: 'onboarding-123', stepName: 'collect_email' },
      context: { email: 'person@example.com', acceptedTerms: true },
      payload: { email: 'person@example.com', acceptedTerms: true },
      payloadFieldSources: { email: 'email', acceptedTerms: 'acceptedTerms' },
    });
  });

  it('maps the file-upload workflow field to the documentId payload for the mock adapter', async () => {
    const connector = createConnector('mock_sumsub_file_upload', 'mock_sumsub_file_upload');
    const service = new WorkflowConnectorExecutorService([connector] as ConnectorAdapterCollection);

    await service.execute(
      [
        {
          name: 'mock_sumsub_file_upload',
          type: 'mock_sumsub_file_upload',
          order: 1,
          fieldMapping: { documentId: 'identityDocument' },
        },
      ],
      { identityDocument: 'doc-123', documentLabel: 'passport' },
      { onboardingId: 'onboarding-123', stepName: 'collect_identity' },
    );

    expect(connector.verify).toHaveBeenCalledWith({
      execution: { onboardingId: 'onboarding-123', stepName: 'collect_identity' },
      context: { identityDocument: 'doc-123', documentLabel: 'passport' },
      payload: { documentId: 'doc-123' },
      payloadFieldSources: { documentId: 'identityDocument' },
    });
  });

  it('short-circuits and returns false when any adapter rejects', async () => {
    const firstConnector = createConnector('adapter_one', 'mock_kyc_1');
    const secondConnector = createConnector('adapter_two', 'mock_kyc_2');
    const service = new WorkflowConnectorExecutorService([
      secondConnector,
      firstConnector,
    ] as ConnectorAdapterCollection);

    firstConnector.verify.mockResolvedValueOnce(false);

    await expect(
      service.execute(
        [
          {
            name: 'decl_two',
            type: 'mock_kyc_2',
            order: 2,
            fieldMapping: { email: 'email' },
          },
          {
            name: 'decl_one',
            type: 'mock_kyc_1',
            order: 1,
            fieldMapping: { email: 'email' },
          },
        ],
        { email: 'person@example.com' },
        { onboardingId: 'onboarding-123', stepName: 'collect_email' },
      ),
    ).resolves.toBe(false);
    expect(firstConnector.verify).toHaveBeenCalledTimes(1);
    expect(secondConnector.verify).not.toHaveBeenCalled();
  });

  it('throws technical error when mapped source field is missing in runtime context', async () => {
    const connector = createConnector('adapter_two', 'mock_kyc_2');
    const service = new WorkflowConnectorExecutorService([connector] as ConnectorAdapterCollection);

    await expect(
      service.execute(
        [
          {
            name: 'decl_two',
            type: 'mock_kyc_2',
            order: 1,
            fieldMapping: { email: 'email', acceptedTerms: 'acceptedTerms' },
          },
        ],
        { acceptedTerms: true },
        { onboardingId: 'onboarding-123', stepName: 'collect_email' },
      ),
    ).rejects.toBeInstanceOf(ConnectorPayloadFieldNotFoundError);
    expect(connector.verify).not.toHaveBeenCalled();
  });
});
