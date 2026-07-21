import { MockSumsubFileUploadConnector } from './mock-sumsub-file-upload.connector';

const createInput = (documentId: unknown) => ({
  execution: { onboardingId: 'onboarding-1', stepName: 'collect_identity' },
  context: { identityDocument: documentId },
  payload: { documentId },
  payloadFieldSources: { documentId: 'identityDocument' },
});

describe('MockSumsubFileUploadConnector', () => {
  it('rejects malformed document ids without reading storage', async () => {
    const resolver = { resolve: jest.fn() };
    const storagePort = { readObject: jest.fn() };
    const connector = new MockSumsubFileUploadConnector(resolver as never, storagePort as never);

    await expect(connector.verify(createInput(''))).resolves.toBe(false);
    await expect(connector.verify(createInput(null))).resolves.toBe(false);
    await expect(connector.verify(createInput(42))).resolves.toBe(false);

    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(storagePort.readObject).not.toHaveBeenCalled();
  });

  it('reads the resolved final object once and returns true after consuming the buffer', async () => {
    const resolver = {
      resolve: jest.fn().mockResolvedValue({
        finalObjectKey: 'final/object',
        verifiedEtag: '"etag-1"',
        verifiedSizeBytes: 128,
      }),
    };
    const storagePort = {
      readObject: jest.fn().mockResolvedValue(Buffer.from('done')),
    };
    const connector = new MockSumsubFileUploadConnector(resolver as never, storagePort as never);

    await expect(connector.verify(createInput('document-1'))).resolves.toBe(true);

    expect(resolver.resolve).toHaveBeenCalledWith({
      documentId: 'document-1',
      onboardingId: 'onboarding-1',
      stepName: 'collect_identity',
      sourceField: 'identityDocument',
    });
    expect(storagePort.readObject).toHaveBeenCalledWith({
      objectKey: 'final/object',
      expectedEtag: '"etag-1"',
      maxBytes: 128,
    });
    expect(storagePort.readObject).toHaveBeenCalledTimes(1);
  });

  it('rejects resolver misses without touching storage and propagates storage errors', async () => {
    const resolver = { resolve: jest.fn().mockResolvedValue(undefined) };
    const storagePort = { readObject: jest.fn() };
    const connector = new MockSumsubFileUploadConnector(resolver as never, storagePort as never);

    await expect(connector.verify(createInput('document-2'))).resolves.toBe(false);
    expect(storagePort.readObject).not.toHaveBeenCalled();

    resolver.resolve.mockResolvedValueOnce({
      finalObjectKey: 'final/object',
      verifiedEtag: '"etag-1"',
      verifiedSizeBytes: 32,
    });
    storagePort.readObject.mockRejectedValueOnce(new Error('read failed'));

    await expect(connector.verify(createInput('document-3'))).rejects.toThrow('read failed');
  });
});
