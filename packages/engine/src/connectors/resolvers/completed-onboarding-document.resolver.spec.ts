import { IsNull, MoreThan, Not } from 'typeorm';
import { CompletedOnboardingDocumentResolver } from './completed-onboarding-document.resolver';

describe('CompletedOnboardingDocumentResolver', () => {
  it('returns a read-only final-object descriptor only for matching completed documents', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue({
        finalObjectKey: 'final/object',
        verifiedEtag: '"etag-1"',
        verifiedSizeBytes: 128,
      }),
    };
    const resolver = new CompletedOnboardingDocumentResolver(repository as never);

    await expect(
      resolver.resolve({
        documentId: 'document-1',
        onboardingId: 'onboarding-1',
        stepName: 'collect_identity',
        sourceField: 'identityDocument',
      }),
    ).resolves.toEqual({
      finalObjectKey: 'final/object',
      verifiedEtag: '"etag-1"',
      verifiedSizeBytes: 128,
    });

    expect(repository.findOne).toHaveBeenCalledWith({
      where: {
        id: 'document-1',
        onboardingId: 'onboarding-1',
        stepName: 'collect_identity',
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
        stepName: 'collect_identity',
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
        stepName: 'collect_identity',
        sourceField: 'identityDocument',
      }),
    ).resolves.toBeUndefined();
  });
});
