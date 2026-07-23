import { Inject, Injectable } from '@nestjs/common';
import type { NormalizedFileField } from '@tsh/ddl-schema';
import { DataSource } from 'typeorm';
import { OBJECT_STORAGE_PORT, ObjectStoragePort } from '../storage/object-storage.port';
import { generateUuidV7 } from '../utils/uuid.util';
import { Workflow } from '../workflows/domain/workflow';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import { ReserveDocumentUploadDto } from './dto/reserve-document-upload.dto';
import { OnboardingDocumentEntity } from './entity/onboarding-document.entity';
import { DocumentUploadConflictException } from './errors/document-upload-conflict.exception';
import { DocumentUploadExpiredException } from './errors/document-upload-expired.exception';
import { DocumentUploadNotFoundException } from './errors/document-upload-not-found.exception';
import { InvalidDocumentUploadException } from './errors/invalid-document-upload.exception';
import { OnboardingDocumentsRepository } from './onboarding-documents.repository';
import { OnboardingsRepository } from './onboardings.repository';

export interface ReserveDocumentUploadResponse {
  documentId: string;
  upload: {
    kind: 'post-form';
    url: string;
    fields: Record<string, string>;
  };
  expiresAt: string;
}

export interface CompleteDocumentUploadResponse {
  documentId: string;
}

const DOCUMENT_RESERVATION_EXPIRY_SECONDS = 300;
const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

@Injectable()
export class DocumentUploadService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly onboardingsRepository: OnboardingsRepository,
    private readonly onboardingDocumentsRepository: OnboardingDocumentsRepository,
    private readonly workflowRegistryService: WorkflowRegistryService,
    @Inject(OBJECT_STORAGE_PORT)
    private readonly objectStoragePort: ObjectStoragePort,
  ) {}

  async reserveDocumentUpload(
    onboardingId: string,
    dto: ReserveDocumentUploadDto,
  ): Promise<ReserveDocumentUploadResponse> {
    const reservationContext = await this.dataSource.transaction(async (manager) => {
      const onboarding = await this.onboardingsRepository.findByIdForUpdate(manager, onboardingId);

      if (!onboarding) {
        throw new DocumentUploadNotFoundException();
      }

      if (onboarding.status === 'approved' || onboarding.completedAt !== null) {
        throw new DocumentUploadConflictException();
      }

      const workflow = this.workflowRegistryService.getById(
        onboarding.workflowId,
        onboarding.workflowVersion,
      );
      const activeFileField = this.resolveActiveFileField(
        workflow,
        onboarding.currentStep,
        dto.field,
      );
      const validation = activeFileField.field.validation;
      if (!validation.contentTypes.includes(dto.contentType)) {
        throw new InvalidDocumentUploadException();
      }

      if (dto.sizeBytes < 1 || dto.sizeBytes > validation.maxSizeBytes) {
        throw new InvalidDocumentUploadException();
      }

      if (!onboarding.currentStep) {
        throw new InvalidDocumentUploadException();
      }

      const pendingReservation =
        await this.onboardingDocumentsRepository.findPendingByOnboardingStepAndField(
          manager,
          onboarding.id,
          onboarding.currentStep,
          dto.field,
        );

      if (pendingReservation && pendingReservation.expiresAt > new Date()) {
        throw new DocumentUploadConflictException();
      }

      const documentId = generateUuidV7();
      const stagingObjectKey = this.buildStagingObjectKey(onboarding.id, documentId);
      const uploadMaxSizeBytes = Math.min(validation.maxSizeBytes, MAX_DOCUMENT_SIZE_BYTES);
      const expiresAt = new Date(Date.now() + DOCUMENT_RESERVATION_EXPIRY_SECONDS * 1000);

      return {
        onboardingId: onboarding.id,
        stepName: onboarding.currentStep,
        fieldName: dto.field,
        documentId,
        stagingObjectKey,
        requestedContentType: dto.contentType,
        requestedSizeBytes: dto.sizeBytes,
        uploadMaxSizeBytes,
        expiresAt,
      };
    });

    const upload = await this.objectStoragePort.issueUploadTicket({
      objectKey: reservationContext.stagingObjectKey,
      contentType: reservationContext.requestedContentType,
      maxSizeBytes: reservationContext.uploadMaxSizeBytes,
      expiresInSeconds: DOCUMENT_RESERVATION_EXPIRY_SECONDS,
    });

    await this.dataSource.transaction(async (manager) => {
      const onboarding = await this.onboardingsRepository.findByIdForUpdate(
        manager,
        reservationContext.onboardingId,
      );
      if (!onboarding) {
        throw new DocumentUploadNotFoundException();
      }

      if (!onboarding.currentStep || onboarding.currentStep !== reservationContext.stepName) {
        throw new InvalidDocumentUploadException();
      }

      const workflow = this.workflowRegistryService.getById(
        onboarding.workflowId,
        onboarding.workflowVersion,
      );
      const activeFileField = this.resolveActiveFileField(
        workflow,
        onboarding.currentStep,
        reservationContext.fieldName,
      );

      if (
        !activeFileField.field.validation.contentTypes.includes(
          reservationContext.requestedContentType,
        )
      ) {
        throw new InvalidDocumentUploadException();
      }

      if (reservationContext.requestedSizeBytes > activeFileField.field.validation.maxSizeBytes) {
        throw new InvalidDocumentUploadException();
      }

      const pendingReservation =
        await this.onboardingDocumentsRepository.findPendingByOnboardingStepAndField(
          manager,
          onboarding.id,
          onboarding.currentStep,
          reservationContext.fieldName,
        );

      if (pendingReservation) {
        if (pendingReservation.expiresAt > new Date()) {
          throw new DocumentUploadConflictException();
        }

        await this.objectStoragePort.deleteStagedObject({
          objectKey: pendingReservation.stagingObjectKey,
        });
        await this.onboardingDocumentsRepository.markExpired(manager, pendingReservation);
      }

      const reservation = Object.assign(new OnboardingDocumentEntity(), {
        id: reservationContext.documentId,
        onboardingId: onboarding.id,
        stepName: onboarding.currentStep,
        fieldName: reservationContext.fieldName,
        status: 'pending' as const,
        stagingObjectKey: reservationContext.stagingObjectKey,
        finalObjectKey: null,
        requestedContentType: reservationContext.requestedContentType,
        requestedMaxSizeBytes: reservationContext.requestedSizeBytes,
        verifiedContentType: null,
        verifiedSizeBytes: null,
        verifiedEtag: null,
        expiresAt: reservationContext.expiresAt,
        completedAt: null,
      });

      await this.onboardingDocumentsRepository.createPendingReservation(manager, reservation);
    });

    return {
      documentId: reservationContext.documentId,
      upload: {
        kind: upload.kind,
        url: upload.url,
        fields: upload.fields,
      },
      expiresAt: reservationContext.expiresAt.toISOString(),
    };
  }

  async completeDocumentUpload(
    onboardingId: string,
    documentId: string,
  ): Promise<CompleteDocumentUploadResponse> {
    const completionContext = await this.dataSource.transaction(async (manager) => {
      const onboarding = await this.onboardingsRepository.findByIdForUpdate(manager, onboardingId);
      if (!onboarding) {
        throw new DocumentUploadNotFoundException();
      }

      const reservation = await this.onboardingDocumentsRepository.findByIdForUpdate(
        manager,
        documentId,
      );
      if (!reservation || reservation.onboardingId !== onboarding.id) {
        throw new DocumentUploadNotFoundException();
      }

      if (reservation.status !== 'pending') {
        throw new InvalidDocumentUploadException();
      }

      if (reservation.expiresAt <= new Date()) {
        throw new DocumentUploadExpiredException();
      }

      if (reservation.stepName !== onboarding.currentStep) {
        throw new InvalidDocumentUploadException();
      }

      const workflow = this.workflowRegistryService.getById(
        onboarding.workflowId,
        onboarding.workflowVersion,
      );
      const activeFileField = this.resolveActiveFileField(
        workflow,
        onboarding.currentStep,
        reservation.fieldName,
      );

      return {
        onboarding,
        reservation,
        validation: activeFileField.field.validation,
      };
    });

    const inspection = await this.inspectReservationObject(completionContext.reservation);

    if (inspection.sizeBytes !== completionContext.reservation.requestedMaxSizeBytes) {
      throw new InvalidDocumentUploadException();
    }

    if (inspection.detectedMimeType !== completionContext.reservation.requestedContentType) {
      throw new InvalidDocumentUploadException();
    }

    if (!completionContext.validation.contentTypes.includes(inspection.detectedMimeType)) {
      throw new InvalidDocumentUploadException();
    }

    if (
      completionContext.validation.maxImageWidth !== undefined ||
      completionContext.validation.maxImageHeight !== undefined
    ) {
      if (!inspection.dimensions) {
        throw new InvalidDocumentUploadException();
      }

      if (
        completionContext.validation.maxImageWidth !== undefined &&
        inspection.dimensions.width > completionContext.validation.maxImageWidth
      ) {
        throw new InvalidDocumentUploadException();
      }

      if (
        completionContext.validation.maxImageHeight !== undefined &&
        inspection.dimensions.height > completionContext.validation.maxImageHeight
      ) {
        throw new InvalidDocumentUploadException();
      }
    }

    const finalObjectKey = this.buildFinalObjectKey(
      completionContext.onboarding.id,
      completionContext.reservation.id,
    );

    await this.promoteReservationObject(
      completionContext.reservation.stagingObjectKey,
      finalObjectKey,
      inspection.etag,
    );

    await this.dataSource.transaction(async (manager) => {
      const onboarding = await this.onboardingsRepository.findByIdForUpdate(manager, onboardingId);
      if (!onboarding) {
        throw new DocumentUploadNotFoundException();
      }

      const reservation = await this.onboardingDocumentsRepository.findByIdForUpdate(
        manager,
        documentId,
      );
      if (!reservation || reservation.onboardingId !== onboarding.id) {
        throw new DocumentUploadNotFoundException();
      }

      if (reservation.status !== 'pending') {
        throw new InvalidDocumentUploadException();
      }

      if (reservation.expiresAt <= new Date()) {
        throw new DocumentUploadExpiredException();
      }

      if (reservation.stepName !== onboarding.currentStep) {
        throw new InvalidDocumentUploadException();
      }

      reservation.finalObjectKey = finalObjectKey;
      reservation.verifiedContentType = inspection.detectedMimeType;
      reservation.verifiedSizeBytes = inspection.sizeBytes;
      reservation.verifiedEtag = inspection.etag;
      await this.onboardingDocumentsRepository.markCompleted(manager, reservation);
    });

    return { documentId };
  }

  private buildStagingObjectKey(onboardingId: string, documentId: string): string {
    return `onboardings/${onboardingId}/${documentId}/staged`;
  }

  private buildFinalObjectKey(onboardingId: string, documentId: string): string {
    return `onboardings/${onboardingId}/${documentId}/final`;
  }

  private resolveActiveFileField(
    workflow: Workflow,
    currentStep: string | null,
    requestedField: string,
  ): { fieldName: string; field: NormalizedFileField } {
    if (!currentStep) {
      throw new InvalidDocumentUploadException();
    }

    const metadata = workflow.getActiveFileFieldMetadata(currentStep);

    if (!metadata || metadata.field.type !== 'file' || metadata.fieldName !== requestedField) {
      throw new InvalidDocumentUploadException();
    }

    const validation = metadata.field.validation;
    if (
      !validation ||
      !Array.isArray(validation.contentTypes) ||
      typeof validation.maxSizeBytes !== 'number'
    ) {
      throw new InvalidDocumentUploadException();
    }

    return {
      fieldName: metadata.fieldName,
      field: metadata.field,
    };
  }

  private async inspectReservationObject(reservation: OnboardingDocumentEntity) {
    try {
      return await this.objectStoragePort.inspectStagedObject({
        objectKey: reservation.stagingObjectKey,
      });
    } catch (error) {
      if (this.isExpectedStorageValidationFailure(error)) {
        throw new InvalidDocumentUploadException();
      }

      throw error;
    }
  }

  private async promoteReservationObject(
    stagingObjectKey: string,
    finalObjectKey: string,
    etag: string,
  ): Promise<void> {
    try {
      await this.objectStoragePort.promoteInspectedObject({
        stagingObjectKey,
        finalObjectKey,
        sourceEtag: etag,
        expectedSourceEtag: etag,
      });
    } catch (error) {
      if (this.isExpectedStorageValidationFailure(error)) {
        throw new InvalidDocumentUploadException();
      }

      throw error;
    }
  }

  private isExpectedStorageValidationFailure(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const maybeError = error as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      Code?: unknown;
      $metadata?: { httpStatusCode?: number };
    };

    const name =
      typeof maybeError.name === 'string'
        ? maybeError.name
        : typeof maybeError.code === 'string'
          ? maybeError.code
          : typeof maybeError.Code === 'string'
            ? maybeError.Code
            : '';
    const message = typeof maybeError.message === 'string' ? maybeError.message : '';
    const status = maybeError.$metadata?.httpStatusCode;

    if (
      [
        'AbortError',
        'TimeoutError',
        'NoSuchKey',
        'NotFound',
        'PreconditionFailed',
        'InvalidObjectState',
      ].includes(name)
    ) {
      return true;
    }

    if ([400, 404, 408, 412, 415, 422].includes(status ?? -1)) {
      return true;
    }

    return /(etag|ifmatch|if-match|mismatch|unsupported|content type|truncated|malformed|size|inspection byte budget|outside the allowed inspection range|empty|timeout|aborted)/i.test(
      `${name} ${message}`,
    );
  }
}
