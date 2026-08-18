import { Injectable, Inject } from '@nestjs/common';
import { OBJECT_STORAGE_PORT, type ObjectStoragePort } from '../../../storage/object-storage.port';
import { ConnectorTier } from '../../ports/connector-adapter.port';
import type { ConnectorAdapter, ConnectorExecutionInput } from '../../ports/connector-adapter.port';
import { ConnectorExecutionResult } from '../../ports/connector-execution-result';
import {
  CompletedOnboardingDocumentResolver,
  type CompletedOnboardingDocumentResolutionInput,
} from '../../resolvers/completed-onboarding-document.resolver';

@Injectable()
export class MockSumsubFileUploadConnector implements ConnectorAdapter {
  readonly name = 'mock_sumsub_file_upload';
  readonly type = 'mock_sumsub_file_upload';
  readonly tier = ConnectorTier.SANDBOX;

  constructor(
    private readonly resolver: CompletedOnboardingDocumentResolver,
    @Inject(OBJECT_STORAGE_PORT) private readonly objectStoragePort: ObjectStoragePort,
  ) {}

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    const documentId = input.payload.documentId;
    if (typeof documentId !== 'string' || documentId.trim().length === 0) {
      return ConnectorExecutionResult.invalid();
    }

    const resolved = await this.resolver.resolve(this.createResolutionInput(input, documentId));
    if (!resolved) {
      return ConnectorExecutionResult.invalid();
    }

    await this.objectStoragePort.inspectStagedObject({
      objectKey: resolved.finalObjectKey,
      expectedEtag: resolved.verifiedEtag,
    });

    return ConnectorExecutionResult.accepted();
  }

  private createResolutionInput(
    input: ConnectorExecutionInput,
    documentId: string,
  ): CompletedOnboardingDocumentResolutionInput {
    return {
      documentId,
      onboardingId: input.execution.onboardingId,
      stepName: input.execution.stepName,
      sourceField: this.resolveSourceField(input),
    };
  }

  private resolveSourceField(input: ConnectorExecutionInput): string {
    const payloadFieldSource = input.payloadFieldSources.documentId;
    return typeof payloadFieldSource === 'string' ? payloadFieldSource : 'documentId';
  }
}
