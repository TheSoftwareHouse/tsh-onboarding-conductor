import { Inject, Injectable } from '@nestjs/common';
import type { NormalizedFileField } from '@tsh/ddl-schema';
import { DataSource, EntityManager } from 'typeorm';
import { OBJECT_STORAGE_PORT, ObjectStoragePort } from '../storage/object-storage.port';
import { generateUuidV7 } from '../utils/uuid.util';
import { Workflow } from '../workflows/domain/workflow';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import { ReserveDocumentUploadDto } from './dto/reserve-document-upload.dto';
import {
  CompleteDocumentUploadResponseDto,
  ReserveDocumentUploadResponseDto,
} from './dto/reserve-document-upload.response.dto';
import { OnboardingDocumentEntity } from './entity/onboarding-document.entity';
import { OnboardingEntity } from './entity/onboarding.entity';
import { DocumentUploadConflictException } from './errors/document-upload-conflict.exception';
import { DocumentUploadExpiredException } from './errors/document-upload-expired.exception';
import { DocumentUploadNotFoundException } from './errors/document-upload-not-found.exception';
import { InvalidDocumentUploadException } from './errors/invalid-document-upload.exception';
import { OnboardingDocumentsRepository } from './onboarding-documents.repository';
import { OnboardingsRepository } from './onboardings.repository';

const DOCUMENT_RESERVATION_EXPIRY_SECONDS = 300;

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
  ): Promise<ReserveDocumentUploadResponseDto> {
    const onboarding = await this.onboardingsRepository.findById(
      this.dataSource.manager,
      onboardingId,
    );

    if (!onboarding) {
      throw new DocumentUploadNotFoundException();
    }

    if (onboarding.status === 'approved' || onboarding.completedAt !== null) {
      throw new DocumentUploadConflictException();
    }

    if (!onboarding.currentStep) {
      throw new InvalidDocumentUploadException();
    }

    if (!Number.isSafeInteger(dto.sizeBytes) || dto.sizeBytes < 1) {
      throw new InvalidDocumentUploadException();
    }

    const reservationContext = await this.dataSource.transaction(async (manager) => {
      await this.lockAndRefreshOnboardingPreflight(manager, onboarding);

      const workflow = await this.workflowRegistryService.getByVersionId(
        onboarding.workflowVersionId,
        manager,
      );
      const activeFileField = this.resolveActiveFileField(
        workflow,
        onboarding.currentStep,
        dto.field,
      );
      const validation = activeFileField.field.validation;
      const requestedContentType = this.normalizeContentType(dto.contentType);
      if (!this.isAcceptedContentType(validation.contentTypes, requestedContentType)) {
        throw new InvalidDocumentUploadException();
      }

      if (dto.sizeBytes > validation.maxSizeBytes) {
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

      if (pendingReservation) {
        await this.objectStoragePort.deleteStagedObject({
          objectKey: pendingReservation.stagingObjectKey,
        });
        await this.onboardingDocumentsRepository.markExpired(manager, pendingReservation);
      }

      const documentId = generateUuidV7();
      const stagingObjectKey = this.buildStagingObjectKey(onboarding.id, documentId);
      const expiresAt = new Date(Date.now() + DOCUMENT_RESERVATION_EXPIRY_SECONDS * 1000);

      const upload = await this.objectStoragePort.issueUploadTicket({
        objectKey: stagingObjectKey,
        contentType: requestedContentType,
        maxSizeBytes: dto.sizeBytes,
        expiresInSeconds: DOCUMENT_RESERVATION_EXPIRY_SECONDS,
      });

      const reservation = Object.assign(new OnboardingDocumentEntity(), {
        id: documentId,
        onboardingId: onboarding.id,
        stepName: onboarding.currentStep,
        fieldName: dto.field,
        status: 'pending' as const,
        stagingObjectKey,
        finalObjectKey: null,
        requestedContentType,
        requestedMaxSizeBytes: dto.sizeBytes,
        verifiedContentType: null,
        verifiedSizeBytes: null,
        verifiedEtag: null,
        expiresAt,
        completedAt: null,
      });

      await this.onboardingDocumentsRepository.createPendingReservation(manager, reservation);

      return {
        documentId,
        stagingObjectKey,
        requestedContentType,
        requestedSizeBytes: dto.sizeBytes,
        expiresAt,
        upload,
      };
    });

    return {
      documentId: reservationContext.documentId,
      upload: {
        kind: reservationContext.upload.kind,
        url: reservationContext.upload.url,
        fields: reservationContext.upload.fields,
      },
      expiresAt: reservationContext.expiresAt.toISOString(),
    };
  }

  async completeDocumentUpload(
    onboardingId: string,
    documentId: string,
  ): Promise<CompleteDocumentUploadResponseDto> {
    const reservation = await this.onboardingDocumentsRepository.findById(
      this.dataSource.manager,
      documentId,
    );
    if (!reservation) {
      throw new DocumentUploadNotFoundException();
    }

    if (reservation.onboardingId !== onboardingId) {
      throw new DocumentUploadNotFoundException();
    }

    const inspection = await this.inspectReservationObject(reservation);
    const onboarding = await this.onboardingsRepository.findById(
      this.dataSource.manager,
      onboardingId,
    );

    if (!onboarding) {
      throw new DocumentUploadNotFoundException();
    }

    let promotionSucceeded = false;

    try {
      await this.dataSource.transaction(async (manager) => {
        await this.lockAndRefreshOnboardingPreflight(manager, onboarding);

        const currentReservation = await this.onboardingDocumentsRepository.findByIdForUpdate(
          manager,
          documentId,
        );
        if (!currentReservation || currentReservation.onboardingId !== onboarding.id) {
          throw new DocumentUploadNotFoundException();
        }

        if (currentReservation.status !== 'pending') {
          throw new InvalidDocumentUploadException();
        }

        if (currentReservation.expiresAt <= new Date()) {
          throw new DocumentUploadExpiredException();
        }

        if (currentReservation.stepName !== onboarding.currentStep) {
          throw new InvalidDocumentUploadException();
        }

        const workflow = await this.workflowRegistryService.getByVersionId(
          onboarding.workflowVersionId,
          manager,
        );
        const activeFileField = this.resolveActiveFileField(
          workflow,
          onboarding.currentStep,
          currentReservation.fieldName,
        );
        const validation = activeFileField.field.validation;

        if (inspection.sizeBytes !== currentReservation.requestedMaxSizeBytes) {
          throw new InvalidDocumentUploadException();
        }

        const detectedContentType = this.normalizeContentType(inspection.detectedMimeType);
        const requestedContentType = this.normalizeContentType(
          currentReservation.requestedContentType,
        );
        if (detectedContentType !== requestedContentType) {
          throw new InvalidDocumentUploadException();
        }

        if (!this.isAcceptedContentType(validation.contentTypes, detectedContentType)) {
          throw new InvalidDocumentUploadException();
        }

        if (validation.maxImageWidth !== undefined || validation.maxImageHeight !== undefined) {
          if (!inspection.dimensions) {
            throw new InvalidDocumentUploadException();
          }

          if (
            validation.maxImageWidth !== undefined &&
            inspection.dimensions.width > validation.maxImageWidth
          ) {
            throw new InvalidDocumentUploadException();
          }

          if (
            validation.maxImageHeight !== undefined &&
            inspection.dimensions.height > validation.maxImageHeight
          ) {
            throw new InvalidDocumentUploadException();
          }
        }

        const finalObjectKey = this.buildFinalObjectKey(onboarding.id, currentReservation.id);

        await this.promoteReservationObject(
          currentReservation.stagingObjectKey,
          finalObjectKey,
          inspection.etag,
        );
        promotionSucceeded = true;

        currentReservation.finalObjectKey = finalObjectKey;
        currentReservation.verifiedContentType = inspection.detectedMimeType;
        currentReservation.verifiedSizeBytes = inspection.sizeBytes;
        currentReservation.verifiedEtag = inspection.etag;
        await this.onboardingDocumentsRepository.markCompleted(manager, currentReservation);
      });
    } catch (error) {
      if (promotionSucceeded) {
        try {
          await this.objectStoragePort.deleteStagedObject({
            objectKey: this.buildFinalObjectKey(onboardingId, documentId),
          });
        } catch {
          // Best-effort cleanup; preserve the original persistence error.
        }
      }

      throw error;
    }

    return { documentId };
  }

  private async lockAndRefreshOnboardingPreflight(
    manager: EntityManager,
    onboarding: OnboardingEntity,
  ): Promise<void> {
    try {
      await this.onboardingsRepository.lockAndRefreshPreflight(manager, onboarding);
    } catch (error) {
      if (this.isOnboardingLockRefreshFailure(error)) {
        throw new DocumentUploadNotFoundException();
      }

      throw error;
    }
  }

  private isOnboardingLockRefreshFailure(error: unknown): boolean {
    return error instanceof Error && error.message === 'ONBOARDING_LOCK_REFRESH_FAILED';
  }

  private buildStagingObjectKey(onboardingId: string, documentId: string): string {
    return `onboardings/${onboardingId}/${documentId}/staged`;
  }

  private normalizeContentType(contentType: string): string {
    return contentType.trim().toLowerCase();
  }

  private isAcceptedContentType(contentTypes: readonly string[], contentType: string): boolean {
    return contentTypes.includes(contentType);
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

    if (!metadata || metadata.fieldName !== requestedField) {
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
