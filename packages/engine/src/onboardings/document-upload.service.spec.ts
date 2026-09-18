import { DataSource, EntityManager } from 'typeorm';
import { Workflow } from '../workflows/domain/workflow';
import { WorkflowEntity } from '../workflows/entity/workflow.entity';
import { WorkflowVersionEntity } from '../workflows/entity/workflow-version.entity';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import { ObjectStoragePort } from '../storage/object-storage.port';
import { OnboardingDocumentEntity } from './entity/onboarding-document.entity';
import { OnboardingEntity } from './entity/onboarding.entity';
import { OnboardingDocumentsRepository } from './onboarding-documents.repository';
import { OnboardingsRepository } from './onboardings.repository';
import { DocumentUploadService } from './document-upload.service';

describe('DocumentUploadService', () => {
  const manager = {} as EntityManager;
  const workflowVersionId = '01912345-6789-7abc-8def-00000000f001';

  const createOnboarding = (overrides: Partial<OnboardingEntity> = {}): OnboardingEntity =>
    Object.assign(new OnboardingEntity(), {
      id: '01912345-6789-7abc-8def-0123456789ab',
      workflowVersionId,
      workflowVersion: Object.assign(new WorkflowVersionEntity(), {
        workflowVersionId,
        version: 3,
        workflow: Object.assign(new WorkflowEntity(), { name: 'passport-check' }),
      }),
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
    transactionOverride?: (callback: (tx: EntityManager) => unknown) => Promise<unknown>,
  ) => {
    const transaction = jest.fn(async (callback: (tx: EntityManager) => unknown) =>
      transactionOverride ? transactionOverride(callback) : callback(manager),
    );
    const dataSource = { transaction, manager } as unknown as DataSource;
    const repository = {
      findById: jest.fn().mockResolvedValue(onboarding ?? null),
      lockAndRefreshPreflight: jest.fn().mockImplementation(async () => undefined),
    } as unknown as OnboardingsRepository;
    const workflow = createWorkflowMock(workflowOverrides as unknown as Record<string, unknown>);

    const onboardingDocumentsRepository = {
      createPendingReservation: jest.fn().mockImplementation(async (_tx, entity) => entity),
      findById: jest.fn().mockResolvedValue(pendingDocument),
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
        url: 'http://storage.test/upload',
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
      getByVersionId: jest.fn().mockReturnValue(workflow),
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
      url: 'http://storage.test/upload',
      fields: {
        key: expect.stringContaining('/staged'),
        'Content-Type': 'image/png',
      },
    });
    expect(result.expiresAt).toEqual(expect.any(String));
    expect(harness.objectStoragePort.issueUploadTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'image/png',
        maxSizeBytes: 256,
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

  it('accepts a 16 MiB reservation when it is within the workflow limit and sends the exact size to the ticket', async () => {
    const onboarding = createOnboarding();
    const workflow = createWorkflowMock({
      getActiveFileFieldMetadata: jest.fn().mockReturnValue({
        fieldName: 'identityDocument',
        field: {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['image/png', 'image/jpeg'],
            maxSizeBytes: 16 * 1024 * 1024,
          },
        },
      }),
    });
    const harness = createHarness(
      onboarding,
      {},
      { getByVersionId: jest.fn().mockReturnValue(workflow) },
      null,
    );

    await harness.service.reserveDocumentUpload(onboarding.id, {
      field: 'identityDocument',
      contentType: 'image/png',
      sizeBytes: 16 * 1024 * 1024,
    });

    expect(harness.objectStoragePort.issueUploadTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        maxSizeBytes: 16 * 1024 * 1024,
      }),
    );
    expect(harness.onboardingDocumentsRepository.createPendingReservation).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        requestedMaxSizeBytes: 16 * 1024 * 1024,
      }),
    );
  });

  it('rejects an over-limit reservation without issuing a ticket or persisting a reservation', async () => {
    const onboarding = createOnboarding();
    const workflow = createWorkflowMock({
      getActiveFileFieldMetadata: jest.fn().mockReturnValue({
        fieldName: 'identityDocument',
        field: {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['image/png', 'image/jpeg'],
            maxSizeBytes: 1024,
          },
        },
      }),
    });
    const harness = createHarness(
      onboarding,
      {},
      { getByVersionId: jest.fn().mockReturnValue(workflow) },
      null,
    );

    await expect(
      harness.service.reserveDocumentUpload(onboarding.id, {
        field: 'identityDocument',
        contentType: 'image/png',
        sizeBytes: 2048,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'INVALID_DOCUMENT_UPLOAD',
        message: 'INVALID_DOCUMENT_UPLOAD',
      },
      status: 400,
    });

    expect(harness.objectStoragePort.issueUploadTicket).not.toHaveBeenCalled();
    expect(harness.onboardingDocumentsRepository.createPendingReservation).not.toHaveBeenCalled();
  });

  it('rejects a below-one reservation size before workflow lookup and storage side effects', async () => {
    const onboarding = createOnboarding();
    const workflowRegistryService = {
      getByVersionId: jest.fn().mockReturnValue(createWorkflowMock()),
    } as unknown as WorkflowRegistryService;
    const harness = createHarness(onboarding, {}, workflowRegistryService, null);

    await expect(
      harness.service.reserveDocumentUpload(onboarding.id, {
        field: 'identityDocument',
        contentType: 'image/png',
        sizeBytes: 0,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'INVALID_DOCUMENT_UPLOAD',
        message: 'INVALID_DOCUMENT_UPLOAD',
      },
      status: 400,
    });

    expect(workflowRegistryService.getByVersionId).not.toHaveBeenCalled();
    expect(harness.objectStoragePort.issueUploadTicket).not.toHaveBeenCalled();
    expect(harness.onboardingDocumentsRepository.createPendingReservation).not.toHaveBeenCalled();
  });

  it('accepts Number.MAX_SAFE_INTEGER as a reservation size', async () => {
    const onboarding = createOnboarding();
    const workflow = createWorkflowMock({
      getActiveFileFieldMetadata: jest.fn().mockReturnValue({
        fieldName: 'identityDocument',
        field: {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['image/png', 'image/jpeg'],
            maxSizeBytes: Number.MAX_SAFE_INTEGER,
          },
        },
      }),
    });
    const harness = createHarness(
      onboarding,
      {},
      { getByVersionId: jest.fn().mockReturnValue(workflow) },
      null,
    );

    await harness.service.reserveDocumentUpload(onboarding.id, {
      field: 'identityDocument',
      contentType: 'image/png',
      sizeBytes: Number.MAX_SAFE_INTEGER,
    });

    expect(harness.objectStoragePort.issueUploadTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        maxSizeBytes: Number.MAX_SAFE_INTEGER,
      }),
    );
  });

  it('rejects values larger than Number.MAX_SAFE_INTEGER before workflow lookup and side effects', async () => {
    const onboarding = createOnboarding();
    const workflowRegistryService = {
      getByVersionId: jest.fn().mockReturnValue(createWorkflowMock()),
    } as unknown as WorkflowRegistryService;
    const harness = createHarness(onboarding, {}, workflowRegistryService, null);

    await expect(
      harness.service.reserveDocumentUpload(onboarding.id, {
        field: 'identityDocument',
        contentType: 'image/png',
        sizeBytes: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'INVALID_DOCUMENT_UPLOAD',
        message: 'INVALID_DOCUMENT_UPLOAD',
      },
      status: 400,
    });

    expect(workflowRegistryService.getByVersionId).not.toHaveBeenCalled();
    expect(harness.objectStoragePort.issueUploadTicket).not.toHaveBeenCalled();
    expect(harness.onboardingDocumentsRepository.createPendingReservation).not.toHaveBeenCalled();
  });

  it('accepts a workflow-defined custom content type such as application/zip for reservation', async () => {
    const onboarding = createOnboarding();
    const workflow = createWorkflowMock({
      getActiveFileFieldMetadata: jest.fn().mockReturnValue({
        fieldName: 'identityDocument',
        field: {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['application/zip'],
            maxSizeBytes: 4096,
          },
        },
      }),
    });
    const harness = createHarness(
      onboarding,
      {},
      { getByVersionId: jest.fn().mockReturnValue(workflow) },
      null,
    );
    (harness.objectStoragePort.issueUploadTicket as jest.Mock).mockResolvedValueOnce({
      kind: 'post-form',
      objectKey: 'staged/object',
      contentType: 'application/zip',
      maxSizeBytes: 4096,
      url: 'http://storage.test/upload',
      fields: {
        key: 'staged/object',
        'Content-Type': 'application/zip',
      },
    });

    const result = await harness.service.reserveDocumentUpload(onboarding.id, {
      field: 'identityDocument',
      contentType: 'application/zip',
      sizeBytes: 256,
    });

    expect(result.upload.fields['Content-Type']).toBe('application/zip');
    expect(harness.onboardingDocumentsRepository.createPendingReservation).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        requestedContentType: 'application/zip',
      }),
    );
  });

  it('revalidates the current step before reservation ticket issuance so stale workflow state cannot emit an external side effect', async () => {
    const onboarding = createOnboarding();
    const staleOnboarding = createOnboarding({ currentStep: 'capture_alias_next' });
    const workflow = createWorkflowMock({
      getActiveFileFieldMetadata: jest.fn().mockImplementation((step: string | null) => {
        if (step === 'capture_alias') {
          return {
            fieldName: 'identityDocument',
            field: {
              type: 'file',
              required: true,
              validation: {
                contentTypes: ['application/zip'],
                maxSizeBytes: 4096,
              },
            },
          };
        }

        return undefined;
      }),
    });
    const harness = createHarness(
      onboarding,
      {},
      { getByVersionId: jest.fn().mockReturnValue(workflow) },
      null,
      async (callback) => callback(manager),
    );
    const repository = harness.service['onboardingsRepository'] as OnboardingsRepository & {
      lockAndRefreshPreflight: jest.Mock;
    };
    repository.lockAndRefreshPreflight.mockImplementationOnce(async (_manager, entity) => {
      Object.assign(entity, staleOnboarding);
    });

    await expect(
      harness.service.reserveDocumentUpload(onboarding.id, {
        field: 'identityDocument',
        contentType: 'application/zip',
        sizeBytes: 256,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'INVALID_DOCUMENT_UPLOAD',
        message: 'INVALID_DOCUMENT_UPLOAD',
      },
      status: 400,
    });

    expect(harness.objectStoragePort.issueUploadTicket).not.toHaveBeenCalled();
    expect(harness.onboardingDocumentsRepository.createPendingReservation).not.toHaveBeenCalled();
  });

  it('propagates reservation persistence failures after ticket issuance without inventing cleanup behavior', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness(onboarding, {}, {}, null);
    const error = new Error('reservation write failed');
    (
      harness.onboardingDocumentsRepository.createPendingReservation as jest.Mock
    ).mockRejectedValueOnce(error);

    await expect(
      harness.service.reserveDocumentUpload(onboarding.id, {
        field: 'identityDocument',
        contentType: 'image/png',
        sizeBytes: 256,
      }),
    ).rejects.toBe(error);

    expect(harness.objectStoragePort.issueUploadTicket).toHaveBeenCalled();
    expect(harness.onboardingDocumentsRepository.createPendingReservation).toHaveBeenCalled();
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

  it('rejects foreign reservation completion before inspecting storage or mutating document state', async () => {
    const onboarding = createOnboarding();
    const foreignReservation = createPendingDocumentReservation({
      onboardingId: '01912345-6789-7abc-8def-999999999999',
      requestedContentType: 'image/png',
      requestedMaxSizeBytes: 256,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const harness = createHarness(onboarding, {}, {}, foreignReservation);

    await expect(
      harness.service.completeDocumentUpload(onboarding.id, foreignReservation.id),
    ).rejects.toMatchObject({
      response: {
        code: 'DOCUMENT_UPLOAD_NOT_FOUND',
        message: 'DOCUMENT_UPLOAD_NOT_FOUND',
      },
      status: 404,
    });

    expect(harness.objectStoragePort.inspectStagedObject).not.toHaveBeenCalled();
    expect(harness.objectStoragePort.promoteInspectedObject).not.toHaveBeenCalled();
    expect(harness.objectStoragePort.deleteStagedObject).not.toHaveBeenCalled();
    expect(harness.onboardingDocumentsRepository.markCompleted).not.toHaveBeenCalled();
    expect(harness.onboardingDocumentsRepository.findByIdForUpdate).not.toHaveBeenCalled();
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

  it('revalidates the current step before promotion so stale workflow state cannot promote a reservation', async () => {
    const onboarding = createOnboarding();
    const staleOnboarding = createOnboarding({ currentStep: 'capture_alias_next' });
    const reservation = createPendingDocumentReservation({
      onboardingId: onboarding.id,
      requestedContentType: 'image/png',
      requestedMaxSizeBytes: 256,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const harness = createHarness(onboarding, {}, {}, reservation);
    const repository = harness.service['onboardingsRepository'] as OnboardingsRepository & {
      lockAndRefreshPreflight: jest.Mock;
    };
    repository.lockAndRefreshPreflight.mockImplementationOnce(async (_manager, entity) => {
      Object.assign(entity, staleOnboarding);
    });
    (harness.objectStoragePort.inspectStagedObject as jest.Mock).mockResolvedValueOnce({
      objectKey: reservation.stagingObjectKey,
      etag: 'etag-123',
      sizeBytes: 256,
      detectedMimeType: 'image/png',
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

  it('returns not found and does not open a reservation transaction when onboarding is missing', async () => {
    const harness = createHarness(undefined, {}, {}, null);

    await expect(
      harness.service.reserveDocumentUpload('01912345-6789-7abc-8def-0123456789ab', {
        field: 'identityDocument',
        contentType: 'image/png',
        sizeBytes: 256,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'DOCUMENT_UPLOAD_NOT_FOUND',
        message: 'DOCUMENT_UPLOAD_NOT_FOUND',
      },
      status: 404,
    });

    expect((harness.service['dataSource'] as DataSource).transaction).not.toHaveBeenCalled();
  });

  it('maps onboarding preflight refresh race to not found during reservation', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness(onboarding, {}, {}, null);
    const repository = harness.service['onboardingsRepository'] as OnboardingsRepository & {
      lockAndRefreshPreflight: jest.Mock;
    };
    repository.lockAndRefreshPreflight.mockRejectedValueOnce(
      new Error('ONBOARDING_LOCK_REFRESH_FAILED'),
    );

    await expect(
      harness.service.reserveDocumentUpload(onboarding.id, {
        field: 'identityDocument',
        contentType: 'image/png',
        sizeBytes: 256,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'DOCUMENT_UPLOAD_NOT_FOUND',
        message: 'DOCUMENT_UPLOAD_NOT_FOUND',
      },
      status: 404,
    });

    expect(harness.objectStoragePort.issueUploadTicket).not.toHaveBeenCalled();
    expect(harness.onboardingDocumentsRepository.createPendingReservation).not.toHaveBeenCalled();
  });

  it('maps onboarding preflight refresh race to not found during completion', async () => {
    const onboarding = createOnboarding();
    const reservation = createPendingDocumentReservation({
      onboardingId: onboarding.id,
      requestedContentType: 'image/png',
      requestedMaxSizeBytes: 256,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const harness = createHarness(onboarding, {}, {}, reservation);
    const repository = harness.service['onboardingsRepository'] as OnboardingsRepository & {
      lockAndRefreshPreflight: jest.Mock;
    };
    repository.lockAndRefreshPreflight.mockRejectedValueOnce(
      new Error('ONBOARDING_LOCK_REFRESH_FAILED'),
    );

    await expect(
      harness.service.completeDocumentUpload(onboarding.id, reservation.id),
    ).rejects.toMatchObject({
      response: {
        code: 'DOCUMENT_UPLOAD_NOT_FOUND',
        message: 'DOCUMENT_UPLOAD_NOT_FOUND',
      },
      status: 404,
    });

    expect(harness.objectStoragePort.promoteInspectedObject).not.toHaveBeenCalled();
    expect(harness.onboardingDocumentsRepository.markCompleted).not.toHaveBeenCalled();
  });

  it('completes a workflow-defined application/zip reservation through inspection, promotion, and verified completion', async () => {
    const onboarding = createOnboarding();
    const reservation = createPendingDocumentReservation({
      onboardingId: onboarding.id,
      stepName: 'capture_alias',
      fieldName: 'identityDocument',
      requestedContentType: 'application/zip',
      requestedMaxSizeBytes: 256,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const workflow = createWorkflowMock({
      getActiveFileFieldMetadata: jest.fn().mockReturnValue({
        fieldName: 'identityDocument',
        field: {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['application/zip'],
            maxSizeBytes: 4096,
          },
        },
      }),
    });
    const harness = createHarness(
      onboarding,
      {},
      { getByVersionId: jest.fn().mockReturnValue(workflow) },
      reservation,
    );
    (harness.objectStoragePort.inspectStagedObject as jest.Mock).mockResolvedValueOnce({
      objectKey: reservation.stagingObjectKey,
      etag: 'etag-123',
      sizeBytes: 256,
      detectedMimeType: 'application/zip',
    });

    const result = await harness.service.completeDocumentUpload(onboarding.id, reservation.id);

    expect(result).toEqual({ documentId: reservation.id });
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
        finalObjectKey: `onboardings/${onboarding.id}/${reservation.id}/final`,
        verifiedContentType: 'application/zip',
        verifiedSizeBytes: 256,
        verifiedEtag: 'etag-123',
      }),
    );
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

  it('completes a reservation when the current workflow lookup reports a lower maxSizeBytes than the reservation declaration', async () => {
    const onboarding = createOnboarding();
    const reservation = createPendingDocumentReservation({
      onboardingId: onboarding.id,
      requestedContentType: 'image/png',
      requestedMaxSizeBytes: 16 * 1024 * 1024,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const workflow = createWorkflowMock({
      getActiveFileFieldMetadata: jest.fn().mockReturnValue({
        fieldName: 'identityDocument',
        field: {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['image/png', 'image/jpeg'],
            maxSizeBytes: 1024,
            maxImageWidth: 1024,
            maxImageHeight: 768,
          },
        },
      }),
    });
    const harness = createHarness(
      onboarding,
      {},
      { getByVersionId: jest.fn().mockReturnValue(workflow) },
      reservation,
    );
    (harness.objectStoragePort.inspectStagedObject as jest.Mock).mockResolvedValueOnce({
      objectKey: reservation.stagingObjectKey,
      etag: 'etag-123',
      sizeBytes: 16 * 1024 * 1024,
      detectedMimeType: 'image/png',
      dimensions: { width: 640, height: 480 },
    });

    await expect(
      harness.service.completeDocumentUpload(onboarding.id, reservation.id),
    ).resolves.toEqual({ documentId: reservation.id });

    expect(harness.objectStoragePort.promoteInspectedObject).toHaveBeenCalled();
    expect(harness.onboardingDocumentsRepository.markCompleted).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        verifiedSizeBytes: 16 * 1024 * 1024,
      }),
    );
  });

  it('rejects completion when inspected bytes differ from the persisted reservation declaration even if the workflow lookup reports a lower maxSizeBytes', async () => {
    const onboarding = createOnboarding();
    const reservation = createPendingDocumentReservation({
      onboardingId: onboarding.id,
      requestedContentType: 'image/png',
      requestedMaxSizeBytes: 16 * 1024 * 1024,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const workflow = createWorkflowMock({
      getActiveFileFieldMetadata: jest.fn().mockReturnValue({
        fieldName: 'identityDocument',
        field: {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['image/png', 'image/jpeg'],
            maxSizeBytes: 1024,
            maxImageWidth: 1024,
            maxImageHeight: 768,
          },
        },
      }),
    });
    const harness = createHarness(
      onboarding,
      {},
      { getByVersionId: jest.fn().mockReturnValue(workflow) },
      reservation,
    );
    (harness.objectStoragePort.inspectStagedObject as jest.Mock).mockResolvedValueOnce({
      objectKey: reservation.stagingObjectKey,
      etag: 'etag-123',
      sizeBytes: 16 * 1024 * 1024 - 1,
      detectedMimeType: 'image/png',
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

  it('rejects completion when the inspected image dimensions exceed the workflow validation even if the size matches the reservation', async () => {
    const onboarding = createOnboarding();
    const reservation = createPendingDocumentReservation({
      onboardingId: onboarding.id,
      requestedContentType: 'image/png',
      requestedMaxSizeBytes: 256,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const workflow = createWorkflowMock({
      getActiveFileFieldMetadata: jest.fn().mockReturnValue({
        fieldName: 'identityDocument',
        field: {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['image/png', 'image/jpeg'],
            maxSizeBytes: 1024,
            maxImageWidth: 320,
            maxImageHeight: 240,
          },
        },
      }),
    });
    const harness = createHarness(
      onboarding,
      {},
      { getByVersionId: jest.fn().mockReturnValue(workflow) },
      reservation,
    );
    (harness.objectStoragePort.inspectStagedObject as jest.Mock).mockResolvedValueOnce({
      objectKey: reservation.stagingObjectKey,
      etag: 'etag-123',
      sizeBytes: 256,
      detectedMimeType: 'image/png',
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

  it('rejects completion when the current workflow no longer lists the inspected mime type', async () => {
    const onboarding = createOnboarding();
    const reservation = createPendingDocumentReservation({
      onboardingId: onboarding.id,
      requestedContentType: 'image/png',
      requestedMaxSizeBytes: 256,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const workflow = createWorkflowMock({
      getActiveFileFieldMetadata: jest.fn().mockReturnValue({
        fieldName: 'identityDocument',
        field: {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['image/jpeg'],
            maxSizeBytes: 4096,
            maxImageWidth: 1024,
            maxImageHeight: 768,
          },
        },
      }),
    });
    const harness = createHarness(
      onboarding,
      {},
      { getByVersionId: jest.fn().mockReturnValue(workflow) },
      reservation,
    );
    (harness.objectStoragePort.inspectStagedObject as jest.Mock).mockResolvedValueOnce({
      objectKey: reservation.stagingObjectKey,
      etag: 'etag-123',
      sizeBytes: 256,
      detectedMimeType: 'image/png',
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

  it('does not delete the final object for pre-promotion validation failures', async () => {
    const onboarding = createOnboarding({ currentStep: 'capture_alias_next' });
    const reservation = createPendingDocumentReservation({
      onboardingId: onboarding.id,
      stepName: 'capture_alias',
      requestedContentType: 'image/png',
      requestedMaxSizeBytes: 256,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const harness = createHarness(onboarding, {}, {}, reservation);
    (harness.objectStoragePort.inspectStagedObject as jest.Mock).mockResolvedValueOnce({
      objectKey: reservation.stagingObjectKey,
      etag: 'etag-123',
      sizeBytes: 256,
      detectedMimeType: 'image/png',
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

    expect(harness.objectStoragePort.deleteStagedObject).not.toHaveBeenCalled();
  });

  it('does not delete the final object when completion is retried after the reservation is already completed', async () => {
    const onboarding = createOnboarding();
    const reservation = createPendingDocumentReservation({
      onboardingId: onboarding.id,
      status: 'completed',
      completedAt: new Date(),
      requestedContentType: 'image/png',
      requestedMaxSizeBytes: 256,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const harness = createHarness(onboarding, {}, {}, reservation);
    (harness.objectStoragePort.inspectStagedObject as jest.Mock).mockResolvedValueOnce({
      objectKey: reservation.stagingObjectKey,
      etag: 'etag-123',
      sizeBytes: 256,
      detectedMimeType: 'image/png',
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

    expect(harness.objectStoragePort.deleteStagedObject).not.toHaveBeenCalled();
  });

  it('tries cleanup of the promoted object when completion persistence fails and preserves the original error', async () => {
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
      sizeBytes: 256,
      detectedMimeType: 'image/png',
      dimensions: { width: 640, height: 480 },
    });
    (harness.onboardingDocumentsRepository.markCompleted as jest.Mock).mockRejectedValueOnce(
      new Error('db write failed'),
    );
    (harness.objectStoragePort.deleteStagedObject as jest.Mock).mockRejectedValueOnce(
      new Error('cleanup failed'),
    );

    await expect(
      harness.service.completeDocumentUpload(onboarding.id, reservation.id),
    ).rejects.toThrow('db write failed');

    expect(harness.objectStoragePort.deleteStagedObject).toHaveBeenCalledWith({
      objectKey: `onboardings/${onboarding.id}/${reservation.id}/final`,
    });
  });

  it('rejects completion when the onboarding step has changed since reservation', async () => {
    const onboarding = createOnboarding({ currentStep: 'capture_alias_next' });
    const reservation = createPendingDocumentReservation({
      onboardingId: onboarding.id,
      stepName: 'capture_alias',
      requestedContentType: 'image/png',
      requestedMaxSizeBytes: 256,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const harness = createHarness(onboarding, {}, {}, reservation);
    (harness.objectStoragePort.inspectStagedObject as jest.Mock).mockResolvedValueOnce({
      objectKey: reservation.stagingObjectKey,
      etag: 'etag-123',
      sizeBytes: 256,
      detectedMimeType: 'image/png',
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

  it('maps inconclusive signature inspection errors to INVALID_DOCUMENT_UPLOAD', async () => {
    const onboarding = createOnboarding();
    const reservation = createPendingDocumentReservation({
      onboardingId: onboarding.id,
      requestedContentType: 'image/png',
      requestedMaxSizeBytes: 256,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const harness = createHarness(onboarding, {}, {}, reservation);
    (harness.objectStoragePort.inspectStagedObject as jest.Mock).mockRejectedValueOnce(
      new Error('storage object content type could not be detected'),
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
