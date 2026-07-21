import { Injectable, Inject } from '@nestjs/common';
import { OBJECT_STORAGE_PORT, type ObjectStoragePort } from '../../storage/object-storage.port';
import type { ConnectorAdapter, ConnectorVerificationInput } from '../ports/connector-adapter.port';
import {
  CompletedOnboardingDocumentResolver,
  type CompletedOnboardingDocumentResolutionInput,
} from '../resolvers/completed-onboarding-document.resolver';

@Injectable()
export class MockSumsubFileUploadConnector implements ConnectorAdapter {
  readonly name = 'mock_sumsub_file_upload';
  readonly type = 'mock_sumsub_file_upload';

  constructor(
    private readonly resolver: CompletedOnboardingDocumentResolver,
    @Inject(OBJECT_STORAGE_PORT) private readonly objectStoragePort: ObjectStoragePort,
  ) {}

  async verify(input: ConnectorVerificationInput): Promise<boolean> {
    const documentId = input.payload.documentId;
    if (typeof documentId !== 'string' || documentId.trim().length === 0) {
      return false;
    }

    const resolved = await this.resolver.resolve(this.createResolutionInput(input, documentId));
    if (!resolved) {
      return false;
    }

    const bytes = await this.objectStoragePort.readObject({
      objectKey: resolved.finalObjectKey,
      expectedEtag: resolved.verifiedEtag,
      maxBytes: resolved.verifiedSizeBytes,
    });

    void bytes;
    return true;
  }

  private createResolutionInput(
    input: ConnectorVerificationInput,
    documentId: string,
  ): CompletedOnboardingDocumentResolutionInput {
    return {
      documentId,
      onboardingId: input.execution.onboardingId,
      stepName: input.execution.stepName,
      sourceField: this.resolveSourceField(input),
    };
  }

  private resolveSourceField(input: ConnectorVerificationInput): string {
    const payloadFieldSource = input.payloadFieldSources.documentId;
    return typeof payloadFieldSource === 'string' ? payloadFieldSource : 'documentId';
  }
}
