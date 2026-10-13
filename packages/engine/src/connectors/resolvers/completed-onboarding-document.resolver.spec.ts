import { IsNull, MoreThan, Not } from 'typeorm';
import { CompletedOnboardingDocumentResolver } from './completed-onboarding-document.resolver';

describe('CompletedOnboardingDocumentResolver', () => {
  it('does not scope the lookup to a step, so a document captured earlier still resolves', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue({
        finalObjectKey: 'final/object',
        verifiedEtag: '"etag-1"',
        verifiedSizeBytes: 128,
        verifiedContentType: 'image/png',
        requestedContentType: 'image/jpeg',
      }),
    };
    const resolver = new CompletedOnboardingDocumentResolver(repository as never);

    await expect(
      resolver.resolve({
        documentId: 'document-1',
        onboardingId: 'onboarding-1',
        sourceField: 'identityDocument',
      }),
    ).resolves.toEqual({
      finalObjectKey: 'final/object',
      verifiedEtag: '"etag-1"',
      verifiedSizeBytes: 128,
      contentType: 'image/png',
    });

    expect(repository.findOne).toHaveBeenCalledWith({
      where: {
        id: 'document-1',
        onboardingId: 'onboarding-1',
        fieldName: 'identityDocument',
        status: 'completed',
        finalObjectKey: Not(IsNull()),
        verifiedEtag: Not(IsNull()),
        verifiedSizeBytes: MoreThan(0),
      },
    });
  });

  it('rejects records that are missing final-object evidence or have invalid size metadata', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue({
        finalObjectKey: '',
        verifiedEtag: '"etag-1"',
        verifiedSizeBytes: 0,
      }),
    };
    const resolver = new CompletedOnboardingDocumentResolver(repository as never);

    await expect(
      resolver.resolve({
        documentId: 'document-1',
        onboardingId: 'onboarding-1',
        sourceField: 'identityDocument',
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects non-safe-integer verifiedSizeBytes values without coercion', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue({
        finalObjectKey: 'final/object',
        verifiedEtag: '"etag-1"',
        verifiedSizeBytes: Number.MAX_SAFE_INTEGER + 1,
      }),
    };
    const resolver = new CompletedOnboardingDocumentResolver(repository as never);

    await expect(
      resolver.resolve({
        documentId: 'document-1',
        onboardingId: 'onboarding-1',
        sourceField: 'identityDocument',
      }),
    ).resolves.toBeUndefined();
  });

  const resolveWithContentTypes = (verified: string | null, requested: string | null) => {
    const repository = {
      findOne: jest.fn().mockResolvedValue({
        finalObjectKey: 'final/object',
        verifiedEtag: '"etag-1"',
        verifiedSizeBytes: 128,
        verifiedContentType: verified,
        requestedContentType: requested,
      }),
    };

    return new CompletedOnboardingDocumentResolver(repository as never).resolve({
      documentId: 'document-1',
      onboardingId: 'onboarding-1',
      sourceField: 'identityDocument',
    });
  };

  it('falls back to the requested content type when none was verified', async () => {
    await expect(resolveWithContentTypes(null, ' image/jpeg ')).resolves.toMatchObject({
      contentType: 'image/jpeg',
    });
  });

  it('treats a document with no content type as unresolved', async () => {
    await expect(resolveWithContentTypes(null, null)).resolves.toBeUndefined();
  });
});
