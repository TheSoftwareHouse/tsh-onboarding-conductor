import { ConnectorDocumentTooLargeError } from './connector-document-too-large.error';
import { CONNECTOR_DOCUMENT_MAX_BYTES, ConnectorDocumentStore } from './connector-document.store';

const ONBOARDING_ID = '33333333-3333-4333-8333-333333333333';
const ETAG = '"etag-1"';

const createDeps = () => ({
  repository: {
    create: jest.fn((row: unknown) => row),
    save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
  },
  storage: {
    putObject: jest
      .fn()
      .mockImplementation(({ objectKey, body }: { objectKey: string; body: Buffer }) =>
        Promise.resolve({ objectKey, etag: ETAG, sizeBytes: body.length }),
      ),
  },
});

const createStore = (deps: ReturnType<typeof createDeps>) =>
  new ConnectorDocumentStore(deps.repository as never, deps.storage as never);

const input = (body: Buffer) => ({
  connectorId: 'lean_bank_data',
  onboardingId: ONBOARDING_ID,
  stepName: 'bank_connect',
  fieldName: 'bankDataDocument',
  contentType: 'Application/JSON',
  body,
});

describe('ConnectorDocumentStore', () => {
  it('writes the bytes to the final key and records a completed row keyed by step and field', async () => {
    const deps = createDeps();
    const body = Buffer.from('{"accounts":[]}');

    const stored = await createStore(deps).store(input(body));

    expect(stored).toEqual({ documentId: expect.any(String), sizeBytes: body.length });
    const objectKey = `onboardings/${ONBOARDING_ID}/${stored.documentId}/final`;
    expect(deps.storage.putObject).toHaveBeenCalledWith({
      objectKey,
      contentType: 'application/json',
      body,
    });
    expect(deps.repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: stored.documentId,
        onboardingId: ONBOARDING_ID,
        stepName: 'bank_connect',
        fieldName: 'bankDataDocument',
        status: 'completed',
        stagingObjectKey: objectKey,
        finalObjectKey: objectKey,
        requestedContentType: 'application/json',
        requestedMaxSizeBytes: body.length,
        verifiedContentType: 'application/json',
        verifiedSizeBytes: body.length,
        verifiedEtag: ETAG,
        completedAt: expect.any(Date),
      }),
    );
  });

  it('refuses a document over the cap before touching storage', async () => {
    const deps = createDeps();

    await expect(
      createStore(deps).store(input(Buffer.alloc(CONNECTOR_DOCUMENT_MAX_BYTES + 1))),
    ).rejects.toBeInstanceOf(ConnectorDocumentTooLargeError);
    expect(deps.storage.putObject).not.toHaveBeenCalled();
    expect(deps.repository.save).not.toHaveBeenCalled();
  });

  it('records nothing when the write fails', async () => {
    const deps = createDeps();
    deps.storage.putObject.mockRejectedValueOnce(new Error('storage down'));

    await expect(createStore(deps).store(input(Buffer.from('{}')))).rejects.toThrow('storage down');
    expect(deps.repository.save).not.toHaveBeenCalled();
  });
});
