import { DataSource, EntityManager } from 'typeorm';
import { Workflow } from '../workflows/domain/workflow';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import { ObjectStoragePort } from '../storage/object-storage.port';
import { OnboardingDocumentEntity } from './entity/onboarding-document.entity';
import { OnboardingEntity } from './entity/onboarding.entity';
import { OnboardingDocumentsRepository } from './onboarding-documents.repository';
import { OnboardingsRepository } from './onboardings.repository';
import { DocumentUploadService } from './document-upload.service';

describe('DocumentUploadService', () => {
  const manager = {} as EntityManager;

  const createOnboarding = (overrides: Partial<OnboardingEntity> = {}): OnboardingEntity =>
    Object.assign(new OnboardingEntity(), {
      id: '01912345-6789-7abc-8def-0123456789ab',
      workflowId: 'passport-check',
      workflowVersion: 3,
      status: 'awaiting_user',
      currentStep: 'capture_alias',
      context: {},
      expiresAt: null,
      completedAt: null,
      ...overrides,
    });

  const createPendingDocumentReservation = (
    overrides: Partial<OnboardingDocumentEntity> = {},
  ): OnboardingDocumentEntity =>
    Object.assign(new OnboardingDocumentEntity(), {
      id: '01912345-6789-7abc-8def-0fedcba98765',
      onboardingId: '01912345-6789-7abc-8def-0123456789ab',
      stepName: 'capture_alias',
      fieldName: 'identityDocument',
      status: 'pending',
      stagingObjectKey:
        'onboardings/01912345-6789-7abc-8def-0123456789ab/01912345-6789-7abc-8def-0fedcba98765/staged',
      finalObjectKey: null,
      requestedContentType: 'image/png',
      requestedMaxSizeBytes: 256,
      verifiedContentType: null,
      verifiedSizeBytes: null,
      verifiedEtag: null,
      expiresAt: new Date('2026-07-20T13:00:00.000Z'),
      completedAt: null,
      ...overrides,
    });

  const createWorkflowMock = (overrides: Record<string, unknown> = {}): Workflow =>
    ({
      initialize: jest.fn().mockReturnValue({
        workflowId: 'passport-check',
        workflowVersion: 3,
        status: 'awaiting_user',
        currentStep: 'capture_alias',
      }),
      evaluate: jest.fn(),
      getActiveFileFieldMetadata: jest.fn().mockReturnValue({
        fieldName: 'identityDocument',
        field: {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['image/png', 'image/jpeg'],
            maxSizeBytes: 4096,
            maxImageWidth: 1024,
            maxImageHeight: 768,
          },
        },
      }),
      ...overrides,
    }) as unknown as Workflow;

  const createHarness = (
    onboarding?: OnboardingEntity,
    workflowOverrides: Partial<Workflow> = {},
    workflowRegistryOverrides: Partial<WorkflowRegistryService> = {},
    pendingDocument: OnboardingDocumentEntity | null = null,
  ) => {
    const transaction = jest.fn(async (callback: (tx: EntityManager) => unknown) =>
      callback(manager),
    );
    const dataSource = { transaction } as unknown as DataSource;
    const repository = {
      findByIdForUpdate: jest.fn().mockResolvedValue(onboarding ?? null),
    } as unknown as OnboardingsRepository;
    const workflow = createWorkflowMock(workflowOverrides as unknown as Record<string, unknown>);

    const onboardingDocumentsRepository = {
      createPendingReservation: jest.fn().mockImplementation(async (_tx, entity) => entity),
      findByIdForUpdate: jest.fn().mockResolvedValue(pendingDocument),
      findPendingByOnboardingStepAndField: jest.fn().mockResolvedValue(pendingDocument),
      markExpired: jest.fn().mockImplementation(async (_tx, entity) => {
        entity.status = 'expired';
        return entity;
      }),
      markCompleted: jest.fn().mockImplementation(async (_tx, entity) => {
        entity.status = 'completed';
        entity.completedAt = new Date();
        return entity;
      }),
    } as unknown as OnboardingDocumentsRepository;

    const objectStoragePort = {
      issueUploadTicket: jest.fn().mockResolvedValue({
        kind: 'post-form',
        objectKey:
          'onboardings/01912345-6789-7abc-8def-0123456789ab/01912345-6789-7abc-8def-0fedcba98765/staged',
        contentType: 'image/png',
        maxSizeBytes: 4096,
        url: 'http://minio.test/upload',
        fields: {
          key: 'onboardings/01912345-6789-7abc-8def-0123456789ab/01912345-6789-7abc-8def-0fedcba98765/staged',
          'Content-Type': 'image/png',
        },
      }),
      inspectStagedObject: jest.fn().mockResolvedValue({
        objectKey:
          'onboardings/01912345-6789-7abc-8def-0123456789ab/01912345-6789-7abc-8def-0fedcba98765/staged',
        etag: 'etag-123',
        sizeBytes: 256,
        detectedMimeType: 'image/png',
        dimensions: { width: 640, height: 480 },
      }),
      promoteInspectedObject: jest.fn().mockResolvedValue(undefined),
      deleteStagedObject: jest.fn().mockResolvedValue(undefined),
    } as unknown as ObjectStoragePort;

    const workflowRegistryService: WorkflowRegistryService = {
      getById: jest.fn().mockReturnValue(workflow),
      ...workflowRegistryOverrides,
    } as unknown as WorkflowRegistryService;

    return {
      service: new DocumentUploadService(
        dataSource,
        repository,
        onboardingDocumentsRepository,
        workflowRegistryService,
        objectStoragePort,
      ),
      onboardingDocumentsRepository,
      objectStoragePort,
    };
  };

  it('reserves a document upload and returns signed upload metadata', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness(onboarding, {}, {}, null);

    const result = await harness.service.reserveDocumentUpload(onboarding.id, {
      field: 'identityDocument',
      contentType: 'image/png',
      sizeBytes: 256,
    });

    expect(result.documentId).toEqual(expect.any(String));
    expect(result.upload).toEqual({
      kind: 'post-form',
      url: 'http://minio.test/upload',
      fields: {
        key: expect.stringContaining('/staged'),
        'Content-Type': 'image/png',
      },
    });
    expect(result.expiresAt).toEqual(expect.any(String));
    expect(harness.objectStoragePort.issueUploadTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'image/png',
        maxSizeBytes: 4096,
      }),
    );
    expect(harness.onboardingDocumentsRepository.createPendingReservation).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        onboardingId: onboarding.id,
        stepName: 'capture_alias',
        fieldName: 'identityDocument',
        status: 'pending',
        requestedContentType: 'image/png',
        requestedMaxSizeBytes: 256,
      }),
    );
  });

  it('rejects reservation when active pending document has not expired', async () => {
    const onboarding = createOnboarding();
    const pending = createPendingDocumentReservation({
      expiresAt: new Date(Date.now() + 60_000),
    });
    const harness = createHarness(onboarding, {}, {}, pending);

    await expect(
      harness.service.reserveDocumentUpload(onboarding.id, {
        field: 'identityDocument',
        contentType: 'image/png',
        sizeBytes: 256,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'DOCUMENT_UPLOAD_CONFLICT',
        message: 'DOCUMENT_UPLOAD_CONFLICT',
      },
      status: 409,
    });

    expect(harness.objectStoragePort.issueUploadTicket).not.toHaveBeenCalled();
    expect(harness.onboardingDocumentsRepository.createPendingReservation).not.toHaveBeenCalled();
  });

  it('replaces expired pending reservation only after deleting staged object', async () => {
    const onboarding = createOnboarding();
    const pending = createPendingDocumentReservation({
      expiresAt: new Date(Date.now() - 60_000),
      stagingObjectKey: 'onboardings/stale/staged',
    });
    const harness = createHarness(onboarding, {}, {}, pending);

    await harness.service.reserveDocumentUpload(onboarding.id, {
      field: 'identityDocument',
      contentType: 'image/png',
      sizeBytes: 256,
    });

    expect(harness.objectStoragePort.deleteStagedObject).toHaveBeenCalledWith({
      objectKey: 'onboardings/stale/staged',
    });
    expect(harness.onboardingDocumentsRepository.markExpired).toHaveBeenCalledWith(
      manager,
      pending,
    );
    expect(harness.onboardingDocumentsRepository.createPendingReservation).toHaveBeenCalledTimes(1);
  });

  it('completes a pending upload without mutating onboarding workflow state', async () => {
    const onboarding = createOnboarding({
      context: { keep: 'value' },
    });
    const reservation = createPendingDocumentReservation({
      onboardingId: onboarding.id,
      stepName: 'capture_alias',
      fieldName: 'identityDocument',
      requestedContentType: 'image/png',
      requestedMaxSizeBytes: 256,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const harness = createHarness(onboarding, {}, {}, reservation);

    const result = await harness.service.completeDocumentUpload(onboarding.id, reservation.id);

    expect(result).toEqual({ documentId: reservation.id });
    expect(harness.objectStoragePort.inspectStagedObject).toHaveBeenCalledWith({
      objectKey: reservation.stagingObjectKey,
    });
    expect(harness.objectStoragePort.promoteInspectedObject).toHaveBeenCalledWith(
      expect.objectContaining({
        stagingObjectKey: reservation.stagingObjectKey,
        finalObjectKey: `onboardings/${onboarding.id}/${reservation.id}/final`,
        sourceEtag: 'etag-123',
        expectedSourceEtag: 'etag-123',
      }),
    );
    expect(harness.onboardingDocumentsRepository.markCompleted).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        id: reservation.id,
        status: 'completed',
        finalObjectKey: `onboardings/${onboarding.id}/${reservation.id}/final`,
        verifiedContentType: 'image/png',
        verifiedSizeBytes: 256,
        verifiedEtag: 'etag-123',
      }),
    );
    expect(onboarding.context).toEqual({ keep: 'value' });
    expect(onboarding.status).toBe('awaiting_user');
    expect(onboarding.currentStep).toBe('capture_alias');
    expect(onboarding.completedAt).toBeNull();
  });

  it('rejects completion when inspected metadata does not match reservation', async () => {
    const onboarding = createOnboarding();
    const reservation = createPendingDocumentReservation({
      onboardingId: onboarding.id,
      requestedContentType: 'image/png',
      requestedMaxSizeBytes: 256,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const harness = createHarness(onboarding, {}, {}, reservation);
    (harness.objectStoragePort.inspectStagedObject as jest.Mock).mockResolvedValueOnce({
      objectKey: reservation.stagingObjectKey,
      etag: 'etag-123',
      sizeBytes: 300,
      detectedMimeType: 'image/jpeg',
      dimensions: { width: 640, height: 480 },
    });

    await expect(
      harness.service.completeDocumentUpload(onboarding.id, reservation.id),
    ).rejects.toMatchObject({
      response: {
        code: 'INVALID_DOCUMENT_UPLOAD',
        message: 'INVALID_DOCUMENT_UPLOAD',
      },
      status: 400,
    });

    expect(harness.objectStoragePort.promoteInspectedObject).not.toHaveBeenCalled();
    expect(harness.onboardingDocumentsRepository.markCompleted).not.toHaveBeenCalled();
  });

  it('maps expected inspection failures to INVALID_DOCUMENT_UPLOAD', async () => {
    const onboarding = createOnboarding();
    const reservation = createPendingDocumentReservation({
      onboardingId: onboarding.id,
      requestedContentType: 'image/png',
      requestedMaxSizeBytes: 256,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const harness = createHarness(onboarding, {}, {}, reservation);
    (harness.objectStoragePort.inspectStagedObject as jest.Mock).mockRejectedValueOnce(
      new Error('storage object content type is unsupported: image/tiff'),
    );

    await expect(
      harness.service.completeDocumentUpload(onboarding.id, reservation.id),
    ).rejects.toMatchObject({
      response: {
        code: 'INVALID_DOCUMENT_UPLOAD',
        message: 'INVALID_DOCUMENT_UPLOAD',
      },
      status: 400,
    });

    expect(harness.objectStoragePort.promoteInspectedObject).not.toHaveBeenCalled();
    expect(harness.onboardingDocumentsRepository.markCompleted).not.toHaveBeenCalled();
  });

  it('maps expected promotion failures to INVALID_DOCUMENT_UPLOAD', async () => {
    const onboarding = createOnboarding();
    const reservation = createPendingDocumentReservation({
      onboardingId: onboarding.id,
      requestedContentType: 'image/png',
      requestedMaxSizeBytes: 256,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const harness = createHarness(onboarding, {}, {}, reservation);
    (harness.objectStoragePort.promoteInspectedObject as jest.Mock).mockRejectedValueOnce(
      new Error('storage promotion refused because the source etag changed'),
    );

    await expect(
      harness.service.completeDocumentUpload(onboarding.id, reservation.id),
    ).rejects.toMatchObject({
      response: {
        code: 'INVALID_DOCUMENT_UPLOAD',
        message: 'INVALID_DOCUMENT_UPLOAD',
      },
      status: 400,
    });

    expect(harness.onboardingDocumentsRepository.markCompleted).not.toHaveBeenCalled();
  });

  it('does not swallow unexpected programming errors during completion storage calls', async () => {
    const onboarding = createOnboarding();
    const reservation = createPendingDocumentReservation({
      onboardingId: onboarding.id,
      requestedContentType: 'image/png',
      requestedMaxSizeBytes: 256,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const harness = createHarness(onboarding, {}, {}, reservation);
    const unexpected = new TypeError('Cannot read properties of undefined');
    (harness.objectStoragePort.inspectStagedObject as jest.Mock).mockRejectedValueOnce(unexpected);

    await expect(
      harness.service.completeDocumentUpload(onboarding.id, reservation.id),
    ).rejects.toBe(unexpected);

    expect(harness.objectStoragePort.promoteInspectedObject).not.toHaveBeenCalled();
    expect(harness.onboardingDocumentsRepository.markCompleted).not.toHaveBeenCalled();
  });
});
