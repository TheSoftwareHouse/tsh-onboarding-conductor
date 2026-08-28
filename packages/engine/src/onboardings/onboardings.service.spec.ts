import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { WorkflowEvaluationResult } from '../workflows/domain/workflow';
import { WorkflowNotFoundException } from '../workflows/errors/workflow-not-found.exception';
import { ConnectorExecutionResult } from '../connectors/ports/connector-execution-result';
import { ConnectorPayloadFieldNotFoundError } from '../connectors/errors/connector-payload-field-not-found.error';
import {
  createAdminOnboardingsPage,
  createHarness,
  createListAdminOnboardingsQuery,
  createOnboarding,
  manager,
} from './testing/onboardings-service.harness';
import type { ConnectorExecutionAuditProjection } from './onboardings.service';

describe('OnboardingsService', () => {
  const firstPageMeta = { pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } };

  it('lists all admin summaries without filters', async () => {
    const harness = createHarness();
    const query = createListAdminOnboardingsQuery();
    const rows = [createOnboarding({ id: 'onboarding-1' })];
    (harness.repository.findForAdmin as jest.Mock).mockResolvedValue(
      createAdminOnboardingsPage(rows),
    );

    const response = await harness.service.listForAdmin(query);

    expect(harness.repository.findForAdmin).toHaveBeenCalledWith(manager, query);
    expect(response).toEqual({
      items: [
        {
          onboardingId: rows[0].id,
          workflowId: rows[0].workflowId,
          workflowVersion: rows[0].workflowVersion,
          status: rows[0].status,
          currentStep: rows[0].currentStep,
          expiresAt: rows[0].expiresAt,
          createdAt: rows[0].createdAt,
          updatedAt: rows[0].updatedAt,
          completedAt: rows[0].completedAt,
          rejectionReason: rows[0].rejectionReason,
        },
      ],
      meta: firstPageMeta,
    });
  });

  it('reads one admin summary by id, in the shape the list reports it', async () => {
    const harness = createHarness();
    const row = createOnboarding({ id: 'onboarding-1' });
    (harness.repository.findById as jest.Mock).mockResolvedValue(row);

    await expect(harness.service.getForAdmin('onboarding-1')).resolves.toEqual({
      onboardingId: row.id,
      workflowId: row.workflowId,
      workflowVersion: row.workflowVersion,
      status: row.status,
      currentStep: row.currentStep,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt,
      rejectionReason: row.rejectionReason,
    });
    expect(harness.repository.findById).toHaveBeenCalledWith(manager, 'onboarding-1');
  });

  it('reports an id that matches no onboarding as not found rather than an empty answer', async () => {
    const harness = createHarness();
    (harness.repository.findById as jest.Mock).mockResolvedValue(null);

    await expect(harness.service.getForAdmin('missing')).rejects.toThrow(NotFoundException);
  });

  it('lists approved admin summaries without filters', async () => {
    const harness = createHarness();
    const query = createListAdminOnboardingsQuery({ status: 'approved' });

    await harness.service.listForAdmin(query);

    expect(harness.repository.findForAdmin).toHaveBeenCalledWith(manager, query);
  });

  it('passes the workflowId filter through to the repository', async () => {
    const harness = createHarness();
    const query = createListAdminOnboardingsQuery({ workflowId: 'passport-check' });

    await harness.service.listForAdmin(query);

    expect(harness.repository.findForAdmin).toHaveBeenCalledWith(manager, query);
  });

  it('passes both filters through to the repository', async () => {
    const harness = createHarness();
    const query = createListAdminOnboardingsQuery({
      status: 'approved',
      workflowId: 'passport-check',
    });

    await harness.service.listForAdmin(query);

    expect(harness.repository.findForAdmin).toHaveBeenCalledWith(manager, query);
  });

  it('passes the workflowVersion filter through to the repository', async () => {
    const harness = createHarness();
    const query = createListAdminOnboardingsQuery({ workflowVersion: 7 });

    await harness.service.listForAdmin(query);

    expect(harness.repository.findForAdmin).toHaveBeenCalledWith(manager, query);
  });

  it('passes the currentStep filter through to the repository', async () => {
    const harness = createHarness();
    const query = createListAdminOnboardingsQuery({ currentStep: 'confirm_identity' });

    await harness.service.listForAdmin(query);

    expect(harness.repository.findForAdmin).toHaveBeenCalledWith(manager, query);
  });

  it('passes the onboardingId filter through to the repository', async () => {
    const harness = createHarness();
    const query = createListAdminOnboardingsQuery({
      onboardingId: '01912345-6789-7abc-8def-0123456789ab',
    });

    await harness.service.listForAdmin(query);

    expect(harness.repository.findForAdmin).toHaveBeenCalledWith(manager, query);
  });

  it('passes the requested page window through to the repository', async () => {
    const harness = createHarness();
    const query = createListAdminOnboardingsQuery({ page: 3, limit: 50 });

    await harness.service.listForAdmin(query);

    expect(harness.repository.findForAdmin).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({ page: 3, limit: 50 }),
    );
  });

  it('reports the page window the repository resolved rather than recomputing one', async () => {
    const harness = createHarness();
    (harness.repository.findForAdmin as jest.Mock).mockResolvedValue(
      createAdminOnboardingsPage([createOnboarding()], {
        total: 21,
        page: 3,
        limit: 10,
        totalPages: 3,
      }),
    );

    const response = await harness.service.listForAdmin(
      createListAdminOnboardingsQuery({ page: 3, limit: 10 }),
    );

    expect(response.items).toHaveLength(1);
    expect(response.meta).toEqual({
      pagination: { page: 3, limit: 10, total: 21, totalPages: 3 },
    });
  });

  it('passes the validated mixed filters to the repository unchanged', async () => {
    const harness = createHarness();
    const query = createListAdminOnboardingsQuery({
      status: 'approved',
      workflowId: 'passport-check',
      workflowVersion: 3,
      currentStep: 'confirm_identity',
      onboardingId: '01912345-6789-7abc-8def-0123456789ab',
    });

    await harness.service.listForAdmin(query);

    const [managerArg, filtersArg] = (harness.repository.findForAdmin as jest.Mock).mock.calls[0];
    expect(managerArg).toBe(manager);
    expect(filtersArg).toBe(query);
  });

  it('returns an empty page when the repository returns no rows', async () => {
    const harness = createHarness();

    await expect(harness.service.listForAdmin(createListAdminOnboardingsQuery())).resolves.toEqual({
      items: [],
      meta: { pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
    });
  });

  it('maps lifecycle summaries and omits context even when the entity contains data', async () => {
    const harness = createHarness();
    const entity = createOnboarding({
      id: 'onboarding-2',
      context: { secret: 'payload' },
      createdAt: new Date('2026-07-16T12:00:00.000Z'),
      updatedAt: new Date('2026-07-16T12:30:00.000Z'),
      completedAt: new Date('2026-07-17T00:00:00.000Z'),
    });
    (harness.repository.findForAdmin as jest.Mock).mockResolvedValue(
      createAdminOnboardingsPage([entity]),
    );

    const response = await harness.service.listForAdmin(createListAdminOnboardingsQuery());

    expect(response).toEqual({
      items: [
        {
          onboardingId: entity.id,
          workflowId: entity.workflowId,
          workflowVersion: entity.workflowVersion,
          status: entity.status,
          currentStep: entity.currentStep,
          expiresAt: entity.expiresAt,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
          completedAt: entity.completedAt,
          rejectionReason: entity.rejectionReason,
        },
      ],
      meta: firstPageMeta,
    });
    expect(response.items[0]).not.toHaveProperty('context');
    expect(response.items[0]).not.toHaveProperty('id');
  });

  it('creates the initial row in a transaction and returns the initial state', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockImplementation(async (_tx, data) => data);

    const response = await harness.service.start({ workflowId: 'unused-name' });

    expect(harness.transaction).toHaveBeenCalledTimes(1);
    expect(harness.workflowRegistryService.getById).toHaveBeenCalledWith('unused-name');
    expect(harness.workflow.initialize).toHaveBeenCalledWith();
    expect(harness.repository.createInitial).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        id: response.onboardingId,
        workflowId: 'passport-check',
        workflowVersion: 3,
        status: 'awaiting_user',
        currentStep: 'capture_alias',
        context: {},
        expiresAt: null,
        completedAt: null,
        rejectionReason: null,
      }),
    );
    expect(response).toEqual({
      onboardingId: expect.any(String),
      status: 'awaiting_user',
      currentStep: 'capture_alias',
      expiresAt: null,
    });
  });

  it('writes a start lifecycle event inside the transaction before notifying', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockImplementation(async (_tx, data) => data);

    await harness.service.start({ workflowId: 'unused-name' });

    expect(harness.auditService.log).toHaveBeenCalledTimes(1);
    expect(harness.auditService.log).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'onboarding.started',
        onboarding: expect.objectContaining({
          workflowId: 'passport-check',
          workflowVersion: 3,
          status: 'awaiting_user',
          currentStep: 'capture_alias',
        }),
        appliedStep: null,
      }),
    );
    expect(harness.transactionOrder).toEqual([
      'transaction:start',
      'audit:write',
      'transaction:resolved',
      'notify:called',
    ]);
  });

  it('returns distinct ids for separate accepted starts', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockImplementation(async (_tx, data) => data);

    const first = await harness.service.start({ workflowId: 'first' });
    const second = await harness.service.start({ workflowId: 'second' });

    expect(first.onboardingId).not.toBe(second.onboardingId);
    expect(harness.repository.createInitial).toHaveBeenCalledTimes(2);
  });

  it('does not generate an id or persist when workflow initialization fails', async () => {
    const harness = createHarness({
      workflowRegistryOverrides: {
        getById: jest.fn().mockImplementation(() => {
          throw new WorkflowNotFoundException();
        }),
      },
    });

    await expect(harness.service.start({ workflowId: 'missing' })).rejects.toMatchObject({
      response: {
        code: 'WORKFLOW_NOT_FOUND',
        message: 'WORKFLOW_NOT_FOUND',
      },
      status: 404,
    });
    expect(harness.transaction).not.toHaveBeenCalled();
    expect(harness.repository.createInitial).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
  });

  it('bubbles onboarding persistence errors from start without mutating state', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockRejectedValue(new Error('db write failed'));

    await expect(harness.service.start({ workflowId: 'passport-check' })).rejects.toThrow(
      'db write failed',
    );

    expect(harness.repository.createInitial).toHaveBeenCalledTimes(1);
  });

  it('returns the stable not-found error for an unknown onboarding', async () => {
    const harness = createHarness();

    await expect(harness.service.submit('missing', {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(harness.service.submit('missing', {})).rejects.toMatchObject({
      response: {
        code: 'ONBOARDING_NOT_FOUND',
        message: 'ONBOARDING_NOT_FOUND',
      },
    });
    expect(harness.repository.findById).toHaveBeenCalledWith(manager, 'missing');
    expect(harness.repository.lockAndRefreshPreflight).not.toHaveBeenCalled();
    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(harness.workflowRegistryService.getById).not.toHaveBeenCalled();
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledTimes(2);
    expect(harness.auditService.logRejectedAttempt).toHaveBeenNthCalledWith(1, harness.dataSource, {
      operation: 'submit',
      outcome: 'onboarding_not_found',
      resourceId: 'missing',
    });
    expect(harness.auditService.logRejectedAttempt).toHaveBeenNthCalledWith(2, harness.dataSource, {
      operation: 'submit',
      outcome: 'onboarding_not_found',
      resourceId: 'missing',
    });
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).not.toHaveBeenCalled();
  });

  it('writes an applied callback audit event for callback-driven submit persistence', async () => {
    const onboarding = createOnboarding({ currentStep: 'capture_alias' });
    const harness = createHarness({ onboarding });
    const expectedConnectorExecutionResult: ConnectorExecutionAuditProjection = {
      status: 'accepted',
    };

    await expect(
      harness.service.submit(
        'onboarding-id',
        { email: 'person@example.com' },
        {
          providerIdentity: 'mock_async_callback',
          resolvedConnector: { connectorOrder: 1, result: ConnectorExecutionResult.accepted() },
        },
      ),
    ).resolves.toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
      rejectionReason: null,
    });

    expect((harness.auditService as jest.Mocked<AuditService>).logWebhook).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'webhook.inbound_callback_applied',
        resourceType: 'onboarding',
        metadata: {
          providerIdentity: 'mock_async_callback',
          connectorOrder: 1,
          submittedData: { email: 'person@example.com' },
          connectorExecutionResult: expectedConnectorExecutionResult,
          outcome: 'persisted',
        },
      }),
    );
  });

  it('rolls back callback-driven submit side effects when applied audit persistence fails', async () => {
    const onboarding = createOnboarding({ currentStep: 'capture_alias' });
    const harness = createHarness({ onboarding });
    const appliedAuditFailure = new Error('applied audit failed');
    (harness.auditService.logWebhook as jest.Mock).mockRejectedValueOnce(appliedAuditFailure);

    await expect(
      harness.service.submit(
        'onboarding-id',
        { email: 'person@example.com' },
        {
          providerIdentity: 'mock_async_callback',
          resolvedConnector: { connectorOrder: 1, result: ConnectorExecutionResult.accepted() },
        },
      ),
    ).rejects.toBe(appliedAuditFailure);

    expect(harness.auditService.log).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      appliedAuditFailure,
      onboarding,
      harness.workflow,
    );
  });

  it('does not run post-commit async start or notify when submit transaction rolls back', async () => {
    const onboarding = createOnboarding({ currentStep: 'capture_alias' });
    const harness = createHarness({
      onboarding,
    });
    const rollbackError = new Error('rollback');
    (harness.repository.saveLocked as jest.Mock).mockRejectedValueOnce(rollbackError);
    await expect(
      harness.service.submit('onboarding-id', { email: 'person@example.com' }),
    ).rejects.toBe(rollbackError);

    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      rollbackError,
      onboarding,
      harness.workflow,
    );
  });

  it('uses the single preflight onboarding object for runtime evaluation and persistence', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        getActiveFileFieldMetadata: jest.fn().mockReturnValue(undefined),
      },
    });

    await expect(
      harness.service.submit('onboarding-id', {
        contactAddress: 'person@example.com',
      }),
    ).resolves.toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
      rejectionReason: null,
    });
    expect(harness.workflowRegistryService.getById).toHaveBeenCalledWith('passport-check', 3);
    expect(harness.workflow.evaluate).toHaveBeenCalledWith({
      currentStep: 'capture_alias',
      submittedData: { contactAddress: 'person@example.com' },
      onboardingContext: {},
      onboardingId: onboarding.id,
    });
    expect(harness.repository.findById).toHaveBeenCalledWith(manager, 'onboarding-id');
    expect(harness.repository.lockAndRefreshPreflight).toHaveBeenCalledWith(manager, onboarding);
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(onboarding.context).toEqual({ contactAddress: 'person@example.com' });

    (harness.workflow.evaluate as jest.Mock).mockResolvedValueOnce(
      WorkflowEvaluationResult.accepted({ identityConfirmed: true }, 'confirm_identity', {
        context: {
          contactAddress: 'person@example.com',
          identityConfirmed: true,
        },
        status: 'approved',
        currentStep: null,
        completedAt: new Date('2026-07-20T10:00:00.000Z'),
        rejectionReason: null,
      }),
    );
    await expect(
      harness.service.submit('onboarding-id', {
        identityConfirmed: true,
      }),
    ).resolves.toEqual({
      appliedStep: 'confirm_identity',
      status: 'approved',
      currentStep: null,
      rejectionReason: null,
    });
    expect(onboarding.context).toEqual({
      contactAddress: 'person@example.com',
      identityConfirmed: true,
    });
    expect(onboarding.completedAt).toEqual(new Date('2026-07-20T10:00:00.000Z'));
    expect(harness.transaction).toHaveBeenCalledTimes(2);
    expect(harness.repository.saveLocked).toHaveBeenCalledTimes(2);
    expect(harness.workflowRegistryService.getById).toHaveBeenCalledTimes(2);
  });

  it('passes the resolved connector result through to workflow evaluation as the minimal continuation bridge', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        getActiveFileFieldMetadata: jest.fn().mockReturnValue(undefined),
      },
    });
    const resolvedResult = ConnectorExecutionResult.accepted();

    await harness.service.submit('onboarding-id', { acceptedTerms: true }, {
      resolvedConnector: { connectorOrder: 1, result: resolvedResult },
    } as const);

    expect(harness.workflow.evaluate).toHaveBeenCalledWith({
      currentStep: 'capture_alias',
      submittedData: { acceptedTerms: true },
      onboardingContext: {},
      onboardingId: onboarding.id,
      continuation: {
        resolvedConnector: {
          connectorOrder: 1,
          result: resolvedResult,
        },
      },
    });
  });

  it('persists submit transition audit and notifies after the transaction', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({ onboarding });

    await expect(
      harness.service.submit('onboarding-id', {
        contactAddress: 'person@example.com',
      }),
    ).resolves.toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
      rejectionReason: null,
    });

    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledWith(
      onboarding,
      harness.workflow,
    );
    expect(harness.auditService.log).toHaveBeenCalledTimes(1);
    expect(harness.auditService.log).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'onboarding.state_transition',
        previousOnboarding: {
          id: onboarding.id,
          workflowId: onboarding.workflowId,
          workflowVersion: onboarding.workflowVersion,
          status: 'awaiting_user',
          currentStep: 'capture_alias',
        },
        newOnboarding: onboarding,
        appliedStep: 'capture_alias',
      }),
    );
    expect(harness.transactionOrder).toEqual([
      'transaction:start',
      'audit:write',
      'transaction:resolved',
      'notify:called',
    ]);
  });

  it('propagates accepted-submit persistence write failure without notify delivery', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({ onboarding });
    const writeFailure = new Error('transition write failed');
    (harness.auditService.log as jest.Mock).mockRejectedValueOnce(writeFailure);

    await expect(
      harness.service.submit('onboarding-id', {
        contactAddress: 'person@example.com',
      }),
    ).rejects.toBe(writeFailure);

    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.auditService.log).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.transactionOrder).toEqual(['transaction:start', 'notifyError:called']);
  });

  it('notifies after the transaction and avoids routing it through notifyError', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({ onboarding });
    (harness.onboardingWebhookService.notify as jest.Mock).mockImplementationOnce(async () => {
      harness.transactionOrder.push('notify:called');
    });

    await expect(
      harness.service.submit('onboarding-id', {
        contactAddress: 'person@example.com',
      }),
    ).resolves.toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
      rejectionReason: null,
    });

    expect(harness.repository.saveLocked).toHaveBeenCalledTimes(1);
    expect(harness.auditService.log).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).not.toHaveBeenCalled();
    expect(harness.transactionOrder).toEqual([
      'transaction:start',
      'audit:write',
      'transaction:resolved',
      'notify:called',
    ]);

    const saveCall = (harness.repository.saveLocked as jest.Mock).mock.invocationCallOrder[0];
    const auditCall = (harness.auditService.log as jest.Mock).mock.invocationCallOrder[0];
    const notifyCall = (harness.onboardingWebhookService.notify as jest.Mock).mock
      .invocationCallOrder[0];
    expect(saveCall).toBeLessThan(auditCall);
    expect(auditCall).toBeLessThan(notifyCall);

    expect(onboarding.context).toEqual({ contactAddress: 'person@example.com' });
    expect(onboarding.status).toBe('awaiting_user');
    expect(onboarding.currentStep).toBe('confirm_identity');
    expect(onboarding.rejectionReason).toBeNull();
    expect(onboarding.completedAt).toBeNull();
  });

  it('accepts a submitted file reference after workflow evaluation without extra service validation', async () => {
    const onboarding = createOnboarding({
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluate: jest.fn().mockResolvedValue(
          WorkflowEvaluationResult.accepted(
            {
              identityDocument: '01912345-6789-7abc-8def-0fedcba98765',
              documentLabel: 'passport',
            },
            'capture_alias',
            {
              context: {
                existing: 'value',
                identityDocument: '01912345-6789-7abc-8def-0fedcba98765',
                documentLabel: 'passport',
              },
              status: 'approved',
              currentStep: null,
              completedAt: new Date('2026-07-20T12:00:00.000Z'),
              rejectionReason: null,
            },
          ),
        ),
      },
    });

    await expect(
      harness.service.submit('onboarding-id', {
        identityDocument: '01912345-6789-7abc-8def-0fedcba98765',
        documentLabel: 'passport',
      }),
    ).resolves.toEqual({
      appliedStep: 'capture_alias',
      status: 'approved',
      currentStep: null,
      rejectionReason: null,
    });
    expect(onboarding.context).toEqual({
      existing: 'value',
      identityDocument: '01912345-6789-7abc-8def-0fedcba98765',
      documentLabel: 'passport',
    });
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
  });

  it('refreshes the same preflight entity under lock before submit evaluation', async () => {
    const onboarding = createOnboarding({
      status: 'awaiting_user',
      currentStep: 'capture_alias',
      context: { stale: true },
      completedAt: null,
    });
    const harness = createHarness({ onboarding });
    const expectedTransition = { status: 'success', target: 'confirm_identity' } as const;
    let transitionDuringRefresh: unknown;
    onboarding.setLifecycleTakenTransition(expectedTransition);
    onboarding.capturePreMutationWebhookSnapshot();

    (harness.repository.lockAndRefreshPreflight as jest.Mock).mockImplementationOnce(
      async (_tx, entity) => {
        transitionDuringRefresh = entity.getLifecycleTakenTransition();
        Object.assign(entity, {
          status: 'awaiting_manual_review',
          currentStep: 'manual_review',
          context: { persisted: 'db-state' },
          completedAt: null,
        });
      },
    );

    await expect(
      harness.service.submit('onboarding-id', { manualDecision: 'approve' }),
    ).resolves.toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
      rejectionReason: null,
    });

    const evaluateInput = (harness.workflow.evaluate as jest.Mock).mock.calls[0][0];
    expect(harness.repository.lockAndRefreshPreflight).toHaveBeenCalledWith(manager, onboarding);
    expect(evaluateInput).toEqual(
      expect.objectContaining({
        currentStep: 'manual_review',
        onboardingContext: { persisted: 'db-state' },
      }),
    );
    expect(transitionDuringRefresh).toEqual(expectedTransition);
    expect(onboarding.getLifecycleTakenTransition()).toEqual(expectedTransition);
    expect(onboarding.getPreMutationWebhookSnapshot()).toEqual({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
      completedAt: null,
    });
  });

  it('does not query document reservation on primitive-only submit', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        getActiveFileFieldMetadata: jest.fn().mockReturnValue(undefined),
        evaluate: jest.fn().mockResolvedValue(
          WorkflowEvaluationResult.accepted(
            { contactAddress: 'person@example.com' },
            'capture_alias',
            {
              context: { contactAddress: 'person@example.com' },
              status: 'awaiting_user',
              currentStep: 'confirm_identity',
              completedAt: null,
              rejectionReason: null,
            },
          ),
        ),
      },
    });

    await expect(
      harness.service.submit('onboarding-id', {
        contactAddress: 'person@example.com',
      }),
    ).resolves.toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
      rejectionReason: null,
    });

    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
  });

  it('returns INVALID_STEP_DATA for retryable non-final verifyCode invalid-data and delegates notifyError', async () => {
    const onboarding = createOnboarding({
      context: { existing: 'value' },
      currentStep: 'verify_code',
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluate: jest
          .fn()
          .mockResolvedValueOnce(
            WorkflowEvaluationResult.retryableInvalidData(
              { verificationCode: ['INVALID'] },
              'verify_code',
            ),
          )
          .mockResolvedValueOnce(
            WorkflowEvaluationResult.accepted(
              { otpConfirmed: true },
              'verify_code',
              {
                context: { existing: 'value', otpConfirmed: true },
                status: 'approved',
                currentStep: null,
                completedAt: new Date('2026-07-20T10:00:00.000Z'),
                rejectionReason: null,
              },
              { status: 'success', target: 'approved' },
            ),
          ),
      },
    });

    const firstAttempt = harness.service.submit('onboarding-id', { verificationCode: '000000' });
    await expect(firstAttempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(firstAttempt).rejects.toMatchObject({
      response: {
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors: { verificationCode: ['INVALID'] },
      },
      status: 400,
    });

    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.auditService.log).not.toHaveBeenCalled();
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledTimes(1);
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledWith(harness.dataSource, {
      operation: 'submit',
      outcome: 'retryable_invalid_data',
      resourceId: 'onboarding-id',
    });
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      expect.any(BadRequestException),
      onboarding,
      harness.workflow,
    );
    expect(onboarding.status).toBe('awaiting_user');
    expect(onboarding.currentStep).toBe('verify_code');
    expect(onboarding.context).toEqual({ existing: 'value' });

    await expect(
      harness.service.submit('onboarding-id', { verificationCode: '123456' }),
    ).resolves.toEqual({
      appliedStep: 'verify_code',
      status: 'approved',
      currentStep: null,
      rejectionReason: null,
    });

    expect(harness.workflow.evaluate).toHaveBeenCalledTimes(2);
    expect(harness.repository.saveLocked).toHaveBeenCalledTimes(1);
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledTimes(1);
    expect(harness.auditService.log).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(onboarding.status).toBe('approved');
    expect(onboarding.currentStep).toBeNull();
    expect(onboarding.context).toEqual({ existing: 'value', otpConfirmed: true });
    expect(onboarding.rejectionReason).toBeNull();
    expect(onboarding.completedAt).toEqual(new Date('2026-07-20T10:00:00.000Z'));
  });

  it('persists invalid UNKNOWN_STATE results with nullable appliedStep for missing server-held state', async () => {
    const onboarding = createOnboarding({
      context: { email: 'person@example.com' },
      currentStep: 'verify_code',
    });
    const rootNotifyWebhook = { path: 'root-state-changed' };
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        getRootNotifyWebhook: jest.fn().mockReturnValue(rootNotifyWebhook),
        evaluate: jest.fn().mockResolvedValue(
          WorkflowEvaluationResult.terminalInvalid('UNKNOWN_STATE', {
            nextState: {
              context: { email: 'person@example.com' },
              status: 'invalid',
              currentStep: null,
              completedAt: new Date('2026-07-20T10:00:00.000Z'),
              rejectionReason: null,
            },
          }),
        ),
      },
    });

    await expect(harness.service.submit('onboarding-id', null)).resolves.toEqual({
      appliedStep: null,
      status: 'invalid',
      currentStep: null,
      rejectionReason: null,
    });

    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledTimes(1);
    expect(harness.auditService.log).toHaveBeenCalledTimes(1);
    expect(onboarding.status).toBe('invalid');
    expect(onboarding.currentStep).toBeNull();
    expect(onboarding.context).toEqual({ email: 'person@example.com' });
    expect(onboarding.completedAt).toEqual(new Date('2026-07-20T10:00:00.000Z'));
  });

  it('throws UnknownWorkflowEvaluationException and delegates notifyError', async () => {
    const onboarding = createOnboarding({
      context: { existing: 'value' },
      currentStep: 'verify_code',
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluate: jest.fn().mockResolvedValue(WorkflowEvaluationResult.unknownEvaluation()),
      },
    });

    await expect(
      harness.service.submit('onboarding-id', { verificationCode: '123456' }),
    ).rejects.toMatchObject({
      response: {
        code: 'UNKNOWN_WORKFLOW_EVALUATION',
        message: 'UNKNOWN_WORKFLOW_EVALUATION',
      },
      status: 409,
    });

    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      expect.any(ConflictException),
      onboarding,
      harness.workflow,
    );
  });

  it('uses nextState.rejectionReason when a rejected result accessor reason differs', async () => {
    const onboarding = createOnboarding({
      context: { email: 'person@example.com' },
      currentStep: 'verify_code',
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluate: jest.fn().mockResolvedValue(
          WorkflowEvaluationResult.rejected(
            {},
            'verify_code',
            {
              context: { email: 'person@example.com' },
              status: 'rejected',
              currentStep: null,
              completedAt: new Date('2026-07-20T09:00:00.000Z'),
              rejectionReason: 'CHALLENGE_EXPIRED',
            },
            'ATTEMPTS_EXHAUSTED',
          ),
        ),
      },
    });

    await expect(
      harness.service.submit('onboarding-id', { verificationCode: '000000' }),
    ).resolves.toEqual({
      appliedStep: 'verify_code',
      status: 'rejected',
      currentStep: null,
      rejectionReason: 'CHALLENGE_EXPIRED',
    });

    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(harness.auditService.log).toHaveBeenCalledTimes(1);
    expect(harness.auditService.log).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'onboarding.state_transition',
        previousOnboarding: {
          id: onboarding.id,
          workflowId: onboarding.workflowId,
          workflowVersion: onboarding.workflowVersion,
          status: 'awaiting_user',
          currentStep: 'verify_code',
        },
        newOnboarding: onboarding,
        appliedStep: 'verify_code',
      }),
    );
    expect(onboarding.status).toBe('rejected');
    expect(onboarding.currentStep).toBeNull();
    expect(onboarding.rejectionReason).toBe('CHALLENGE_EXPIRED');
  });

  it('persists null rejection reasons for non-rejected results', async () => {
    const onboarding = createOnboarding({ currentStep: 'capture_alias' });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluate: jest.fn().mockResolvedValue(
          WorkflowEvaluationResult.accepted(
            { contactAddress: 'person@example.com' },
            'capture_alias',
            {
              context: { contactAddress: 'person@example.com' },
              status: 'awaiting_user',
              currentStep: 'confirm_identity',
              completedAt: null,
              rejectionReason: null,
            },
          ),
        ),
      },
    });

    await expect(
      harness.service.submit('onboarding-id', { contactAddress: 'person@example.com' }),
    ).resolves.toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
      rejectionReason: null,
    });

    expect(onboarding.rejectionReason).toBeNull();
  });

  it('awaits runtime evaluation before applying onboarding mutations and save', async () => {
    let resolveEvaluation: ((value: WorkflowEvaluationResult) => void) | undefined;
    const onboarding = createOnboarding();
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        getActiveFileFieldMetadata: jest.fn().mockReturnValue(undefined),
        evaluate: jest.fn().mockImplementation(
          () =>
            new Promise<WorkflowEvaluationResult>((resolve) => {
              resolveEvaluation = resolve;
            }),
        ),
      },
    });

    const submitPromise = harness.service.submit('onboarding-id', {
      contactAddress: 'person@example.com',
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(harness.repository.saveLocked).not.toHaveBeenCalled();

    expect(resolveEvaluation).toBeDefined();
    resolveEvaluation!(
      WorkflowEvaluationResult.accepted({ contactAddress: 'person@example.com' }, 'capture_alias', {
        context: { contactAddress: 'person@example.com' },
        status: 'awaiting_user',
        currentStep: 'confirm_identity',
        completedAt: null,
        rejectionReason: null,
      }),
    );

    await expect(submitPromise).resolves.toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
      rejectionReason: null,
    });
    expect(harness.repository.saveLocked).toHaveBeenCalledTimes(1);
    expect(onboarding.context).toEqual({ contactAddress: 'person@example.com' });
  });

  it('rejects completed onboarding without invoking evaluate and delegates notifyError', async () => {
    const onboarding = createOnboarding({
      status: 'approved',
      currentStep: null,
      context: { contactAddress: 'person@example.com', identityConfirmed: true },
      completedAt: new Date('2026-07-16T12:00:00.000Z'),
    });
    const harness = createHarness({ onboarding });
    await expect(
      harness.service.submit('onboarding-id', { identityConfirmed: true }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(harness.workflowRegistryService.getById).toHaveBeenCalledWith('passport-check', 3);
    expect(harness.workflow.evaluate).not.toHaveBeenCalled();
    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.auditService.log).not.toHaveBeenCalled();
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledTimes(1);
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledWith(harness.dataSource, {
      operation: 'submit',
      outcome: 'onboarding_completed',
      resourceId: 'onboarding-id',
    });
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      expect.any(ConflictException),
      onboarding,
      harness.workflow,
    );
    expect(onboarding).toMatchObject({
      status: 'approved',
      currentStep: null,
      context: { contactAddress: 'person@example.com', identityConfirmed: true },
    });
  });

  it('bubbles technical runtime mapping error and delegates notifyError', async () => {
    const onboarding = createOnboarding({ context: { email: 'person@example.com' } });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluate: jest
          .fn()
          .mockRejectedValue(
            new ConnectorPayloadFieldNotFoundError('acceptedTerms', 'mock_kyc_2', 'mock_kyc_2'),
          ),
      },
    });

    await expect(harness.service.submit('onboarding-id', { acceptedTerms: true })).rejects.toThrow(
      'Connector payload field not found in context: sourceField=acceptedTerms, type=mock_kyc_2, name=mock_kyc_2',
    );

    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      expect.any(ConnectorPayloadFieldNotFoundError),
      onboarding,
      harness.workflow,
    );
    expect(onboarding).toMatchObject({
      status: 'awaiting_user',
      currentStep: 'capture_alias',
      context: { email: 'person@example.com' },
      completedAt: null,
    });
  });

  it('persists a targeted manual review result and marks terminal completion', async () => {
    const onboarding = createOnboarding({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest.fn().mockImplementation((input) =>
          WorkflowEvaluationResult.accepted({}, 'manual_review', {
            context: {
              ...(input.onboardingContext ?? {}),
              manualDecision: 'approved',
            },
            status: 'approved',
            currentStep: null,
            completedAt: new Date('2026-07-20T10:00:00.000Z'),
            rejectionReason: null,
          }),
        ),
      },
    });

    const result = await harness.service.manualReview('onboarding-id', 'manual.approve');

    expect(result).toEqual({
      appliedStep: 'manual_review',
      status: 'approved',
      currentStep: null,
    });
    expect(harness.workflow.evaluateManual).toHaveBeenCalledWith(
      {
        currentStep: 'manual_review',
        submittedData: {},
        onboardingContext: { existing: 'value' },
      },
      'manual.approve',
    );
    expect(harness.repository.findById).toHaveBeenCalledWith(manager, 'onboarding-id');
    expect(harness.repository.lockAndRefreshPreflight).toHaveBeenCalledWith(manager, onboarding);
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(harness.auditService.log).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'onboarding.manual_review_decision',
        previousOnboarding: expect.objectContaining({
          status: 'awaiting_manual_review',
          currentStep: 'manual_review',
        }),
        newOnboarding: onboarding,
        appliedStep: 'manual_review',
        manualTrigger: 'manual.approve',
      }),
    );
    expect(onboarding.status).toBe('approved');
    expect(onboarding.currentStep).toBeNull();
    expect(onboarding.context).toEqual({
      existing: 'value',
      manualDecision: 'approved',
    });
    expect(onboarding.completedAt).toEqual(new Date('2026-07-20T10:00:00.000Z'));
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledTimes(1);
    expect(harness.transactionOrder).toEqual([
      'transaction:start',
      'audit:write',
      'transaction:resolved',
      'notify:called',
    ]);
  });

  it('does not notify on manual review when transaction rolls back', async () => {
    const rollbackError = new Error('manual review rollback');
    const onboarding = createOnboarding({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest.fn().mockReturnValue(
          WorkflowEvaluationResult.accepted({}, 'manual_review', {
            context: { existing: 'value', manualDecision: 'approved' },
            status: 'approved',
            currentStep: null,
            completedAt: new Date('2026-07-20T10:00:00.000Z'),
            rejectionReason: null,
          }),
        ),
      },
    });
    (harness.repository.saveLocked as jest.Mock).mockRejectedValueOnce(rollbackError);

    await expect(harness.service.manualReview('onboarding-id', 'manual.approve')).rejects.toBe(
      rollbackError,
    );

    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      rollbackError,
      onboarding,
      harness.workflow,
    );
  });

  it('persists a targeted terminal manual invalid result and applies state updates', async () => {
    const onboarding = createOnboarding({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest.fn().mockReturnValue(
          WorkflowEvaluationResult.accepted({}, 'manual_review', {
            context: {
              existing: 'value',
              manualDecision: 'invalid',
            },
            status: 'invalid',
            currentStep: null,
            completedAt: new Date('2026-07-20T11:00:00.000Z'),
            rejectionReason: null,
          }),
        ),
      },
    });

    const result = await harness.service.manualReview('onboarding-id', 'manual.invalid');

    expect(result).toEqual({
      appliedStep: 'manual_review',
      status: 'invalid',
      currentStep: null,
    });
    expect(onboarding.status).toBe('invalid');
    expect(onboarding.currentStep).toBeNull();
    expect(onboarding.context).toEqual({
      existing: 'value',
      manualDecision: 'invalid',
    });
    expect(onboarding.completedAt).toEqual(new Date('2026-07-20T11:00:00.000Z'));
    expect(onboarding.rejectionReason).toBeNull();
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
  });

  it('still applies and notifies a valid manual result even when it looks recursive', async () => {
    const onboarding = createOnboarding({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest.fn().mockReturnValue(
          WorkflowEvaluationResult.accepted(
            {},
            'manual_review',
            {
              context: {
                existing: 'value',
                manualDecision: 'returned',
              },
              status: 'awaiting_manual_review',
              currentStep: 'manual_review',
              completedAt: null,
              rejectionReason: null,
            },
            { status: 'manual.invalid', target: 'manual_review' },
          ),
        ),
      },
    });

    const result = await harness.service.manualReview('onboarding-id', 'manual.invalid');

    expect(result).toEqual({
      appliedStep: 'manual_review',
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
    });
    expect(onboarding.context).toEqual({
      existing: 'value',
      manualDecision: 'returned',
    });
    expect(onboarding.rejectionReason).toBeNull();
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledWith(
      expect.objectContaining({ id: onboarding.id }),
      harness.workflow,
    );
  });

  it('returns the manual transition conflict without saving when no manual path is available', async () => {
    const onboarding = createOnboarding({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest
          .fn()
          .mockReturnValue(WorkflowEvaluationResult.manualTransitionUnavailable()),
      },
    });

    await expect(
      harness.service.manualReview('onboarding-id', 'manual.reject'),
    ).rejects.toMatchObject({
      response: {
        code: 'MANUAL_TRANSITION_NOT_AVAILABLE',
        message: 'MANUAL_TRANSITION_NOT_AVAILABLE',
      },
      status: 409,
    });

    expect(onboarding.status).toBe('awaiting_manual_review');
    expect(onboarding.currentStep).toBe('manual_review');
    expect(onboarding.context).toEqual({ existing: 'value' });
    expect(onboarding.completedAt).toBeNull();
    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
  });

  it('throws UnknownWorkflowEvaluationException for explicit unknown evaluation during manual review and delegates notifyError', async () => {
    const onboarding = createOnboarding({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest.fn().mockReturnValue(WorkflowEvaluationResult.unknownEvaluation()),
      },
    });

    await expect(
      harness.service.manualReview('onboarding-id', 'manual.reject'),
    ).rejects.toMatchObject({
      response: {
        code: 'UNKNOWN_WORKFLOW_EVALUATION',
        message: 'UNKNOWN_WORKFLOW_EVALUATION',
      },
      status: 409,
    });

    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledTimes(1);
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledWith(harness.dataSource, {
      operation: 'manual_review',
      outcome: 'unknown_workflow_evaluation',
      resourceId: 'onboarding-id',
    });
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      expect.any(ConflictException),
      onboarding,
      harness.workflow,
    );
  });

  it('persists a rejected manual review outcome as a terminal state', async () => {
    const onboarding = createOnboarding({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest.fn().mockReturnValue(
          WorkflowEvaluationResult.accepted({}, 'manual_review', {
            context: { existing: 'value' },
            status: 'rejected',
            currentStep: null,
            completedAt: new Date('2026-07-20T11:00:00.000Z'),
            rejectionReason: null,
          }),
        ),
      },
    });

    const result = await harness.service.manualReview('onboarding-id', 'manual.reject');

    expect(result).toEqual({
      appliedStep: 'manual_review',
      status: 'rejected',
      currentStep: null,
    });
    expect(onboarding.status).toBe('rejected');
    expect(onboarding.currentStep).toBeNull();
    expect(onboarding.completedAt).toEqual(new Date('2026-07-20T11:00:00.000Z'));
    expect(onboarding.rejectionReason).toBeNull();
  });

  it('audits manual-review not-found as a rejected attempt and preserves the not-found domain response', async () => {
    const harness = createHarness();

    await expect(harness.service.manualReview('missing', 'manual.approve')).rejects.toMatchObject({
      response: {
        code: 'ONBOARDING_NOT_FOUND',
        message: 'ONBOARDING_NOT_FOUND',
      },
      status: 404,
    });

    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledTimes(1);
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledWith(harness.dataSource, {
      operation: 'manual_review',
      outcome: 'onboarding_not_found',
      resourceId: 'missing',
    });
  });

  it('uses preflight onboarding and rejects completed onboardings before evaluation', async () => {
    const onboarding = createOnboarding({
      status: 'approved',
      currentStep: null,
      context: { existing: 'value' },
      completedAt: new Date('2026-07-16T12:00:00.000Z'),
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest.fn(),
      },
    });

    await expect(
      harness.service.manualReview('onboarding-id', 'manual.approve'),
    ).rejects.toMatchObject({
      response: {
        code: 'ONBOARDING_COMPLETED',
        message: 'ONBOARDING_COMPLETED',
      },
      status: 409,
    });

    expect(harness.transaction).toHaveBeenCalledTimes(1);
    expect(harness.repository.findById).toHaveBeenCalledWith(manager, 'onboarding-id');
    expect(harness.repository.lockAndRefreshPreflight).toHaveBeenCalledWith(manager, onboarding);
    expect(harness.workflow.evaluateManual).not.toHaveBeenCalled();
    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledTimes(1);
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledWith(harness.dataSource, {
      operation: 'manual_review',
      outcome: 'onboarding_completed',
      resourceId: 'onboarding-id',
    });
  });

  it('audits submit unknown evaluation as a rejected attempt', async () => {
    const onboarding = createOnboarding({
      context: { existing: 'value' },
      currentStep: 'verify_code',
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluate: jest.fn().mockResolvedValue(WorkflowEvaluationResult.unknownEvaluation()),
      },
    });

    await expect(
      harness.service.submit('onboarding-id', { verificationCode: '123456' }),
    ).rejects.toMatchObject({
      response: {
        code: 'UNKNOWN_WORKFLOW_EVALUATION',
        message: 'UNKNOWN_WORKFLOW_EVALUATION',
      },
      status: 409,
    });

    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledTimes(1);
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledWith(harness.dataSource, {
      operation: 'submit',
      outcome: 'unknown_workflow_evaluation',
      resourceId: 'onboarding-id',
    });
  });

  it('audits unavailable manual-review transition as a rejected attempt', async () => {
    const onboarding = createOnboarding({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest
          .fn()
          .mockReturnValue(WorkflowEvaluationResult.manualTransitionUnavailable()),
      },
    });

    await expect(
      harness.service.manualReview('onboarding-id', 'manual.reject'),
    ).rejects.toMatchObject({
      response: {
        code: 'MANUAL_TRANSITION_NOT_AVAILABLE',
        message: 'MANUAL_TRANSITION_NOT_AVAILABLE',
      },
      status: 409,
    });

    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledTimes(1);
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledWith(harness.dataSource, {
      operation: 'manual_review',
      outcome: 'transition_unavailable',
      resourceId: 'onboarding-id',
    });
  });

  it('propagates submit rejected-attempt audit failures', async () => {
    const harness = createHarness();
    const auditWriteFailure = new Error('isolated audit insert failed');
    (harness.auditService.logRejectedAttempt as jest.Mock).mockRejectedValueOnce(auditWriteFailure);

    await expect(harness.service.submit('missing', {})).rejects.toBe(auditWriteFailure);

    expect(harness.onboardingWebhookService.notifyError).not.toHaveBeenCalled();
  });

  it('propagates manual-review rejected-attempt audit failures', async () => {
    const onboarding = createOnboarding({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest.fn().mockReturnValue(WorkflowEvaluationResult.unknownEvaluation()),
      },
    });
    const auditWriteFailure = new Error('manual rejected-attempt audit failed');
    (harness.auditService.logRejectedAttempt as jest.Mock).mockRejectedValueOnce(auditWriteFailure);

    await expect(harness.service.manualReview('onboarding-id', 'manual.approve')).rejects.toBe(
      auditWriteFailure,
    );

    expect(harness.onboardingWebhookService.notifyError).not.toHaveBeenCalled();
  });
});
