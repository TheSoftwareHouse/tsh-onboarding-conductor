import type { ObjectStoragePort } from '../../../../storage/object-storage.port';
import type {
  CompletedOnboardingDocumentResolution,
  CompletedOnboardingDocumentResolutionInput,
  CompletedOnboardingDocumentResolver,
} from '../../../resolvers/completed-onboarding-document.resolver';

/**
 * Resolves a document the client completed and reads its verified bytes from object storage.
 * `undefined` means the reference resolves to no completed document.
 */
export async function readCompletedDocument(
  documentResolver: CompletedOnboardingDocumentResolver,
  objectStoragePort: ObjectStoragePort,
  input: CompletedOnboardingDocumentResolutionInput,
): Promise<{ resolved: CompletedOnboardingDocumentResolution; content: Buffer } | undefined> {
  const resolved = await documentResolver.resolve(input);

  if (!resolved) {
    return undefined;
  }

  const content = await objectStoragePort.readObject({
    objectKey: resolved.finalObjectKey,
    expectedEtag: resolved.verifiedEtag,
    maxBytes: resolved.verifiedSizeBytes,
  });

  return { resolved, content };
}
