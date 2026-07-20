import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import type { ConnectorAdapter, ConnectorAdapterCollection } from './connector.adapter';
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
    const acceptedData = { email: 'person@example.com', acceptedTerms: true };
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

    await service.execute(declarations, acceptedData);

    expect(firstConnector.verify).toHaveBeenCalledWith({ email: 'person@example.com' });
    expect(secondConnector.verify).toHaveBeenCalledWith({ acceptedTerms: true });
    expect(firstConnector.verify).toHaveBeenCalledTimes(1);
    expect(secondConnector.verify).toHaveBeenCalledTimes(1);
    expect(acceptedData).toEqual({ email: 'person@example.com', acceptedTerms: true });
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
      ),
    ).rejects.toThrow('Connector not registered for type=unknown_type');
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
      ),
    ).rejects.toThrow('Multiple connectors registered for type=mock_kyc_1');
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
    );

    expect(firstConnector.verify).toHaveBeenCalledWith({ email: 'person@example.com' });
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
});
