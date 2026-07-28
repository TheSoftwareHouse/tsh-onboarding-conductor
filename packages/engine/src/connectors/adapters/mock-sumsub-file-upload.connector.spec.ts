import { MockSumsubFileUploadConnector } from './mock-sumsub-file-upload.connector';
import { ConnectorExecutionResult } from '../ports/connector-execution-result';

const createInput = (documentId: unknown) => ({
  declaration: {
    order: 1,
    config: {},
  },
  execution: { onboardingId: 'onboarding-1', stepName: 'collect_identity' },
  context: { identityDocument: documentId },
  payload: { documentId },
  payloadFieldSources: { documentId: 'identityDocument' },
});

const createInputWithConfig = (documentId: unknown, config: Record<string, unknown>) => ({
  ...createInput(documentId),
  declaration: {
    order: 1,
    config,
  },
});

describe('MockSumsubFileUploadConnector', () => {
  it('ignores arbitrary connector config and still verifies uploaded documents', async () => {
    const resolver = {
      resolve: jest.fn().mockResolvedValue({
        finalObjectKey: 'final/object',
        verifiedEtag: '"etag-1"',
        verifiedSizeBytes: 128,
      }),
    };
    const storagePort = {
      inspectStagedObject: jest.fn().mockResolvedValue({
        objectKey: 'final/object',
        etag: '"etag-1"',
        sizeBytes: 128,
        detectedMimeType: 'application/pdf',
      }),
      readObject: jest.fn(),
    };
    const connector = new MockSumsubFileUploadConnector(resolver as never, storagePort as never);

    await expect(
      connector.execute(
        createInputWithConfig('document-1', {
          operation: 'adapter-private-operation',
          random: { nested: true },
          attempts: [1, 2, 3],
        }),
      ),
    ).resolves.toEqual(ConnectorExecutionResult.accepted());
  });

  it('rejects malformed document ids without inspecting storage', async () => {
    const resolver = { resolve: jest.fn() };
    const storagePort = {
      inspectStagedObject: jest.fn(),
      readObject: jest.fn(),
    };
    const connector = new MockSumsubFileUploadConnector(resolver as never, storagePort as never);

    await expect(connector.execute(createInput(''))).resolves.toEqual(
      ConnectorExecutionResult.invalid(),
    );
    await expect(connector.execute(createInput(null))).resolves.toEqual(
      ConnectorExecutionResult.invalid(),
    );
    await expect(connector.execute(createInput(42))).resolves.toEqual(
      ConnectorExecutionResult.invalid(),
    );

    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(storagePort.inspectStagedObject).not.toHaveBeenCalled();
    expect(storagePort.readObject).not.toHaveBeenCalled();
  });

  it('uses inspectStagedObject with the resolved final object key and persisted ETag for bounded verification', async () => {
    const resolver = {
      resolve: jest.fn().mockResolvedValue({
        finalObjectKey: 'final/object',
        verifiedEtag: '"etag-1"',
        verifiedSizeBytes: 128,
      }),
    };
    const storagePort = {
      inspectStagedObject: jest.fn().mockResolvedValue({
        objectKey: 'final/object',
        etag: '"etag-1"',
        sizeBytes: 128,
        detectedMimeType: 'application/pdf',
      }),
      readObject: jest.fn(),
    };
    const connector = new MockSumsubFileUploadConnector(resolver as never, storagePort as never);

    await expect(connector.execute(createInput('document-1'))).resolves.toEqual(
      ConnectorExecutionResult.accepted(),
    );

    expect(resolver.resolve).toHaveBeenCalledWith({
      documentId: 'document-1',
      onboardingId: 'onboarding-1',
      stepName: 'collect_identity',
      sourceField: 'identityDocument',
    });
    expect(storagePort.inspectStagedObject).toHaveBeenCalledWith({
      objectKey: 'final/object',
      expectedEtag: '"etag-1"',
    });
    expect(storagePort.inspectStagedObject).toHaveBeenCalledTimes(1);
    expect(storagePort.readObject).not.toHaveBeenCalled();
  });

  it('rejects resolver misses without touching storage and propagates inspection errors', async () => {
    const resolver = { resolve: jest.fn().mockResolvedValue(undefined) };
    const storagePort = {
      inspectStagedObject: jest.fn(),
      readObject: jest.fn(),
    };
    const connector = new MockSumsubFileUploadConnector(resolver as never, storagePort as never);

    await expect(connector.execute(createInput('document-2'))).resolves.toEqual(
      ConnectorExecutionResult.invalid(),
    );
    expect(storagePort.inspectStagedObject).not.toHaveBeenCalled();
    expect(storagePort.readObject).not.toHaveBeenCalled();

    resolver.resolve.mockResolvedValueOnce({
      finalObjectKey: 'final/object',
      verifiedEtag: '"etag-1"',
      verifiedSizeBytes: 32,
    });
    storagePort.inspectStagedObject.mockRejectedValueOnce(new Error('inspect failed'));

    await expect(connector.execute(createInput('document-3'))).rejects.toThrow('inspect failed');
    expect(storagePort.readObject).not.toHaveBeenCalled();
  });
});
