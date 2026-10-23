import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnboardingDocumentEntity } from '../../onboardings/entity/onboarding-document.entity';
import { buildFinalObjectKey } from '../../onboardings/onboarding-document-keys';
import { OBJECT_STORAGE_PORT, type ObjectStoragePort } from '../../storage/object-storage.port';
import { generateUuidV7 } from '../../utils/uuid.util';
import { ConnectorDocumentTooLargeError } from './connector-document-too-large.error';

const BYTES_PER_KIB = 1024;
const KIB_PER_MIB = 1024;

/**
 * The most a connector may store as one document: the credit step's default upload cap. A `file`
 * field's own `maxSizeBytes` is enforced at reserve, which a connector-written document never
 * passes through, so the cap is the store's.
 */
export const CONNECTOR_DOCUMENT_MAX_BYTES = BYTES_PER_KIB * KIB_PER_MIB;

export type ConnectorDocumentInput = Readonly<{
  connectorId: string;
  onboardingId: string;
  /** The step parked on the connector: the one that declares `fieldName`. */
  stepName: string;
  fieldName: string;
  contentType: string;
  body: Buffer;
}>;

export type StoredConnectorDocument = Readonly<{ documentId: string; sizeBytes: number }>;

/**
 * The one way a connector produces a document for a later step
 * (`docs/decisions/0050-connector-stored-documents-and-lean-bank-data-export.md`). The bytes go
 * straight to the final key the upload flow would have promoted them to, and the
 * `onboarding_documents` row is inserted already `completed`, keyed like an uploaded one: by the
 * onboarding, the parked step and the field it declares. `CompletedOnboardingDocumentResolver` and
 * the file-field replay of a continuation therefore read it unchanged. No staging, no inspection:
 * the engine wrote the bytes itself.
 */
@Injectable()
export class ConnectorDocumentStore {
  constructor(
    @InjectRepository(OnboardingDocumentEntity)
    private readonly repository: Repository<OnboardingDocumentEntity>,
    @Inject(OBJECT_STORAGE_PORT)
    private readonly objectStoragePort: ObjectStoragePort,
  ) {}

  async store(input: ConnectorDocumentInput): Promise<StoredConnectorDocument> {
    if (input.body.length > CONNECTOR_DOCUMENT_MAX_BYTES) {
      throw new ConnectorDocumentTooLargeError(
        input.connectorId,
        input.body.length,
        CONNECTOR_DOCUMENT_MAX_BYTES,
      );
    }

    const documentId = generateUuidV7();
    const objectKey = buildFinalObjectKey(input.onboardingId, documentId);
    const contentType = input.contentType.trim().toLowerCase();
    const written = await this.objectStoragePort.putObject({
      objectKey,
      contentType,
      body: input.body,
    });
    const now = new Date();

    await this.repository.save(
      this.repository.create({
        id: documentId,
        onboardingId: input.onboardingId,
        stepName: input.stepName,
        fieldName: input.fieldName,
        status: 'completed',
        stagingObjectKey: objectKey,
        finalObjectKey: objectKey,
        requestedContentType: contentType,
        requestedMaxSizeBytes: written.sizeBytes,
        verifiedContentType: contentType,
        verifiedSizeBytes: written.sizeBytes,
        verifiedEtag: written.etag,
        expiresAt: now,
        completedAt: now,
      }),
    );

    return { documentId, sizeBytes: written.sizeBytes };
  }
}
