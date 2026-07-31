import { DataSource, EntityManager } from 'typeorm';
import { AuditLogEntity } from './entity/audit-log.entity';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  const createManager = () => ({}) as EntityManager;

  it('writes started lifecycle facts with a null prior snapshot and allowlisted metadata', async () => {
    const repository = {
      insert: jest.fn(),
      findByFilters: jest.fn(),
    } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
    const sut = new AuditService(repository as unknown as AuditRepository);
    const manager = createManager();
    const entity = Object.assign(new AuditLogEntity(), {
      id: '01912345-6789-7abc-8def-0123456789ac',
      occurredAt: new Date('2026-07-21T10:00:00.000Z'),
      actorType: 'system',
      actorId: 'engine',
      action: 'onboarding.started',
      resourceType: 'onboarding',
      resourceId: '01912345-6789-7abc-8def-0123456789aa',
      metadata: {
        workflowId: 'passport-check',
        workflowVersion: 1,
        appliedStep: 'await_account',
        fromStatus: null,
        toStatus: 'draft',
        fromCurrentStep: null,
        toCurrentStep: 'review',
      },
      before: null,
      after: { foo: 'bar' },
      hashPrev: null,
      hashSelf: null,
    });
    repository.insert.mockResolvedValue(entity);

    const result = await sut.log(manager, {
      action: 'onboarding.started',
      onboarding: {
        id: '01912345-6789-7abc-8def-0123456789aa',
        workflowId: 'passport-check',
        workflowVersion: 1,
        status: 'draft',
        currentStep: 'review',
      },
      appliedStep: 'await_account',
    } as never);

    expect(repository.insert).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        actorType: 'system',
        actorId: 'engine',
        action: 'onboarding.started',
        resourceType: 'onboarding',
        resourceId: '01912345-6789-7abc-8def-0123456789aa',
        metadata: {
          workflowId: 'passport-check',
          workflowVersion: 1,
          appliedStep: 'await_account',
          fromStatus: null,
          toStatus: 'draft',
          fromCurrentStep: null,
          toCurrentStep: 'review',
        },
        before: null,
        after: {
          id: '01912345-6789-7abc-8def-0123456789aa',
          workflowId: 'passport-check',
          workflowVersion: 1,
          status: 'draft',
          currentStep: 'review',
        },
        hashPrev: null,
        hashSelf: null,
      }),
    );
    expect(result).toBe(entity);
  });

  it('writes state transition facts with a safe lifecycle snapshot and allowlisted metadata', async () => {
    const repository = {
      insert: jest.fn(),
      findByFilters: jest.fn(),
    } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
    const sut = new AuditService(repository as unknown as AuditRepository);
    const manager = createManager();
    const entity = Object.assign(new AuditLogEntity(), {
      id: '01912345-6789-7abc-8def-0123456789ac',
      occurredAt: new Date('2026-07-21T10:00:00.000Z'),
      actorType: 'system',
      actorId: 'engine',
      action: 'onboarding.state_transition',
      resourceType: 'onboarding',
      resourceId: '01912345-6789-7abc-8def-0123456789aa',
      metadata: {
        workflowId: 'passport-check',
        workflowVersion: 1,
        appliedStep: 'await_account',
        fromStatus: 'draft',
        toStatus: 'submitted',
        fromCurrentStep: 'review',
        toCurrentStep: 'await_account',
      },
      before: { foo: 'bar' },
      after: { foo: 'baz' },
      hashPrev: null,
      hashSelf: null,
    });
    repository.insert.mockResolvedValue(entity);

    const result = await sut.log(manager, {
      action: 'onboarding.state_transition',
      previousOnboarding: {
        id: '01912345-6789-7abc-8def-0123456789aa',
        workflowId: 'passport-check',
        workflowVersion: 1,
        status: 'draft',
        currentStep: 'review',
      },
      newOnboarding: {
        id: '01912345-6789-7abc-8def-0123456789aa',
        workflowId: 'passport-check',
        workflowVersion: 1,
        status: 'submitted',
        currentStep: 'await_account',
      },
      appliedStep: 'await_account',
      submittedData: { passportNumber: '123456' },
      webhookPayload: { event: 'submitted' },
    } as never);

    expect(repository.insert).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        actorType: 'system',
        actorId: 'engine',
        action: 'onboarding.state_transition',
        resourceType: 'onboarding',
        resourceId: '01912345-6789-7abc-8def-0123456789aa',
        metadata: {
          workflowId: 'passport-check',
          workflowVersion: 1,
          appliedStep: 'await_account',
          fromStatus: 'draft',
          toStatus: 'submitted',
          fromCurrentStep: 'review',
          toCurrentStep: 'await_account',
        },
        before: {
          id: '01912345-6789-7abc-8def-0123456789aa',
          workflowId: 'passport-check',
          workflowVersion: 1,
          status: 'draft',
          currentStep: 'review',
        },
        after: {
          id: '01912345-6789-7abc-8def-0123456789aa',
          workflowId: 'passport-check',
          workflowVersion: 1,
          status: 'submitted',
          currentStep: 'await_account',
        },
        hashPrev: null,
        hashSelf: null,
      }),
    );
    expect(result).toBe(entity);
  });

  it('writes manual-review decision facts with a safe manual trigger and lifecycle snapshots', async () => {
    const repository = {
      insert: jest.fn(),
      findByFilters: jest.fn(),
    } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
    const sut = new AuditService(repository as unknown as AuditRepository);
    const manager = createManager();
    const entity = Object.assign(new AuditLogEntity(), {
      id: '01912345-6789-7abc-8def-0123456789ac',
      occurredAt: new Date('2026-07-21T10:00:00.000Z'),
      actorType: 'system',
      actorId: 'engine',
      action: 'onboarding.manual_review_decision',
      resourceType: 'onboarding',
      resourceId: '01912345-6789-7abc-8def-0123456789aa',
      metadata: {
        workflowId: 'passport-check',
        workflowVersion: 1,
        appliedStep: 'await_account',
        fromStatus: 'submitted',
        toStatus: 'approved',
        fromCurrentStep: 'await_account',
        toCurrentStep: 'approved',
        manualTrigger: 'manual.approve',
      },
      before: { foo: 'bar' },
      after: { foo: 'baz' },
      hashPrev: null,
      hashSelf: null,
    });
    repository.insert.mockResolvedValue(entity);

    const result = await sut.log(manager, {
      action: 'onboarding.manual_review_decision',
      previousOnboarding: {
        id: '01912345-6789-7abc-8def-0123456789aa',
        workflowId: 'passport-check',
        workflowVersion: 1,
        status: 'submitted',
        currentStep: 'await_account',
      },
      newOnboarding: {
        id: '01912345-6789-7abc-8def-0123456789aa',
        workflowId: 'passport-check',
        workflowVersion: 1,
        status: 'approved',
        currentStep: 'approved',
      },
      appliedStep: 'await_account',
      manualTrigger: 'manual.approve',
      rejectionReason: 'looks good',
      callerIdentity: 'admin@example.com',
      webhookPayload: { event: 'manual-approved' },
    } as never);

    expect(repository.insert).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        actorType: 'system',
        actorId: 'engine',
        action: 'onboarding.manual_review_decision',
        resourceType: 'onboarding',
        resourceId: '01912345-6789-7abc-8def-0123456789aa',
        metadata: {
          workflowId: 'passport-check',
          workflowVersion: 1,
          appliedStep: 'await_account',
          fromStatus: 'submitted',
          toStatus: 'approved',
          fromCurrentStep: 'await_account',
          toCurrentStep: 'approved',
          manualTrigger: 'manual.approve',
        },
        before: {
          id: '01912345-6789-7abc-8def-0123456789aa',
          workflowId: 'passport-check',
          workflowVersion: 1,
          status: 'submitted',
          currentStep: 'await_account',
        },
        after: {
          id: '01912345-6789-7abc-8def-0123456789aa',
          workflowId: 'passport-check',
          workflowVersion: 1,
          status: 'approved',
          currentStep: 'approved',
        },
        hashPrev: null,
        hashSelf: null,
      }),
    );
    expect(result).toBe(entity);
  });

  it('projects only the explicit audit fields and omits disallowed sensitive values', async () => {
    const repository = {
      insert: jest.fn(),
      findByFilters: jest.fn(),
    } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
    const sut = new AuditService(repository as unknown as AuditRepository);
    const manager = createManager();
    const occurredAt = new Date('2026-07-21T10:00:00.000Z');
    repository.findByFilters.mockResolvedValue({
      items: [
        Object.assign(new AuditLogEntity(), {
          id: '01912345-6789-7abc-8def-0123456789ac',
          occurredAt,
          actorType: 'system',
          actorId: 'engine',
          action: 'onboarding.state_transition',
          resourceType: 'onboarding',
          resourceId: '01912345-6789-7abc-8def-0123456789aa',
          metadata: {
            workflowId: 'passport-check',
            workflowVersion: 1,
            appliedStep: 'await_account',
            fromStatus: 'draft',
            toStatus: 'submitted',
            fromCurrentStep: 'review',
            toCurrentStep: 'await_account',
            sensitive: 'do-not-store',
          },
          before: { foo: 'bar' },
          after: { foo: 'baz' },
          hashPrev: 'prev',
          hashSelf: 'self',
        }),
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    const result = await sut.list(manager, {
      actorType: 'system',
      action: 'onboarding.state_transition',
    } as never);

    expect(repository.findByFilters).toHaveBeenCalledWith(manager, {
      actorType: 'system',
      action: 'onboarding.state_transition',
    });
    expect(result).toEqual({
      items: [
        {
          id: '01912345-6789-7abc-8def-0123456789ac',
          occurredAt,
          actorType: 'system',
          actorId: 'engine',
          action: 'onboarding.state_transition',
          resourceType: 'onboarding',
          resourceId: '01912345-6789-7abc-8def-0123456789aa',
          metadata: {
            workflowId: 'passport-check',
            workflowVersion: 1,
            appliedStep: 'await_account',
            fromStatus: 'draft',
            toStatus: 'submitted',
            fromCurrentStep: 'review',
            toCurrentStep: 'await_account',
          },
        },
      ],
      meta: {
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
        },
      },
    });
    expect(result.items[0]).not.toHaveProperty('before');
    expect(result.items[0]).not.toHaveProperty('after');
    expect(result.items[0]).not.toHaveProperty('hashPrev');
    expect(result.items[0]).not.toHaveProperty('hashSelf');
    expect(result.items[0]).not.toHaveProperty('sensitive');
  });

  it('writes rejected-attempt events via an isolated DataSource transaction with fixed metadata only', async () => {
    const repository = {
      insert: jest.fn(),
      findByFilters: jest.fn(),
    } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
    const manager = createManager();
    const dataSource = {
      transaction: jest.fn(async (callback: (tx: EntityManager) => unknown) => callback(manager)),
    } as unknown as DataSource;
    const sut = new AuditService(repository as unknown as AuditRepository);

    await sut.logRejectedAttempt(dataSource, {
      operation: 'submit',
      outcome: 'retryable_invalid_data',
      resourceId: '01912345-6789-7abc-8def-0123456789aa',
    });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(repository.insert).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        actorType: 'system',
        actorId: 'engine',
        action: 'onboarding.rejected_attempt',
        resourceType: 'onboarding',
        resourceId: '01912345-6789-7abc-8def-0123456789aa',
        metadata: {
          operation: 'submit',
          outcome: 'retryable_invalid_data',
        },
        before: null,
        after: null,
        hashPrev: null,
        hashSelf: null,
      }),
    );
  });

  it('rejects unsupported rejected-attempt operation/outcome combinations before insert', async () => {
    const repository = {
      insert: jest.fn(),
      findByFilters: jest.fn(),
    } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
    const dataSource = {
      transaction: jest.fn(),
    } as unknown as DataSource;
    const sut = new AuditService(repository as unknown as AuditRepository);

    await expect(
      sut.logRejectedAttempt(dataSource, {
        operation: 'submit',
        outcome: 'unsupported_action' as never,
        resourceId: '01912345-6789-7abc-8def-0123456789aa',
      }),
    ).rejects.toThrow('Unsupported rejected-attempt mapping: submit:unsupported_action');

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it.each([
    {
      action: 'webhook.inbound_callback_received',
      resourceType: 'provider_callback',
      resourceId: 'provider-callback-42',
      metadata: { ingress: 'provider_callback' },
    },
    {
      action: 'webhook.inbound_callback_rejected',
      resourceType: 'provider_callback',
      resourceId: 'provider-callback-43',
      metadata: { reason: 'authentication_failed' },
    },
    {
      action: 'webhook.inbound_callback_mapping_failed',
      resourceType: 'provider_callback',
      resourceId: 'provider-callback-44',
      metadata: { reason: 'mapping_failed' },
    },
    {
      action: 'webhook.inbound_callback_applied',
      resourceType: 'onboarding',
      resourceId: 'onboarding-42',
      metadata: {
        providerIdentity: 'mock-provider',
        connectorOrder: 2,
        outcome: 'persisted',
      },
    },
    {
      action: 'webhook.outbound_notification_suppressed',
      resourceType: 'onboarding',
      resourceId: 'onboarding-43',
      metadata: {
        operation: 'notify',
        reason: 'no_configured_webhook',
      },
    },
    {
      action: 'webhook.outbound_endpoint_resolution_failed',
      resourceType: 'onboarding',
      resourceId: 'onboarding-44',
      metadata: {
        eventType: 'onboarding.state_changed',
        reason: 'endpoint_resolution_failed',
      },
    },
    {
      action: 'webhook.outbound_intent_created',
      resourceType: 'client_webhook_outbox',
      resourceId: 'outbox-42',
      metadata: {
        onboardingId: 'onboarding-45',
        eventType: 'onboarding.state_changed',
        status: 'pending',
        attempt: 0,
      },
    },
    {
      action: 'webhook.outbound_delivery_attempted',
      resourceType: 'client_webhook_outbox',
      resourceId: 'outbox-43',
      metadata: {
        onboardingId: 'onboarding-46',
        eventType: 'onboarding.state_changed',
        attempt: 1,
      },
    },
    {
      action: 'webhook.outbound_delivery_succeeded',
      resourceType: 'client_webhook_outbox',
      resourceId: 'outbox-44',
      metadata: {
        onboardingId: 'onboarding-47',
        eventType: 'onboarding.state_changed',
        attempt: 2,
        status: 'delivered',
      },
    },
    {
      action: 'webhook.outbound_delivery_failed',
      resourceType: 'client_webhook_outbox',
      resourceId: 'outbox-45',
      metadata: {
        onboardingId: 'onboarding-48',
        eventType: 'onboarding.state_changed',
        attempt: 3,
        status: 'pending',
        reason: 'delivery_failed',
      },
    },
    {
      action: 'webhook.outbound_resend_requested',
      resourceType: 'client_webhook_outbox',
      resourceId: 'outbox-46',
      metadata: { operation: 'resend' },
    },
    {
      action: 'webhook.outbound_resend_not_found',
      resourceType: 'client_webhook_outbox',
      resourceId: 'outbox-47',
      metadata: { outcome: 'not_found' },
    },
    {
      action: 'webhook.outbound_resend_noop',
      resourceType: 'client_webhook_outbox',
      resourceId: 'outbox-48',
      metadata: { outcome: 'claim_lost' },
    },
  ])(
    'writes webhook event $action with the approved actor defaults and null snapshots',
    async ({ action, resourceType, resourceId, metadata }) => {
      const repository = {
        insert: jest.fn(),
        findByFilters: jest.fn(),
      } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
      const sut = new AuditService(repository as unknown as AuditRepository);
      const manager = createManager();
      repository.insert.mockResolvedValue(Object.assign(new AuditLogEntity(), {}));

      await sut.logWebhook(manager, {
        action: action as never,
        resourceType: resourceType as never,
        resourceId,
        metadata: metadata as never,
      } as never);

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          actorType: 'system',
          actorId: 'engine',
          action,
          resourceType,
          resourceId,
          metadata,
          before: null,
          after: null,
          hashPrev: null,
          hashSelf: null,
        }),
      );
    },
  );

  it('rejects unsupported webhook action/resource/metadata combinations before insert', async () => {
    const repository = {
      insert: jest.fn(),
      findByFilters: jest.fn(),
    } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
    const sut = new AuditService(repository as unknown as AuditRepository);
    const manager = createManager();

    await expect(
      sut.logWebhook(manager, {
        action: 'webhook.inbound_callback_received' as never,
        resourceType: 'onboarding' as never,
        resourceId: 'onboarding-1',
        metadata: { ingress: 'provider_callback' },
      } as never),
    ).rejects.toThrow(
      'Unsupported webhook audit mapping: webhook.inbound_callback_received:provider_callback/onboarding',
    );

    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('projects only the allowlisted webhook metadata and omits unsafe fields', async () => {
    const repository = {
      insert: jest.fn(),
      findByFilters: jest.fn(),
    } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
    const sut = new AuditService(repository as unknown as AuditRepository);
    const manager = createManager();
    const occurredAt = new Date('2026-07-21T10:00:00.000Z');
    repository.findByFilters.mockResolvedValue({
      items: [
        Object.assign(new AuditLogEntity(), {
          id: '01912345-6789-7abc-8def-0123456789ac',
          occurredAt,
          actorType: 'system',
          actorId: 'engine',
          action: 'webhook.inbound_callback_applied',
          resourceType: 'onboarding',
          resourceId: 'onboarding-42',
          metadata: {
            providerIdentity: 'mock-provider',
            connectorOrder: 2,
            outcome: 'persisted',
            sensitive: 'do-not-store',
          },
          before: null,
          after: null,
          hashPrev: null,
          hashSelf: null,
        }),
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    const result = await sut.list(manager, { action: 'webhook.inbound_callback_applied' } as never);

    expect(result).toEqual({
      items: [
        {
          id: '01912345-6789-7abc-8def-0123456789ac',
          occurredAt,
          actorType: 'system',
          actorId: 'engine',
          action: 'webhook.inbound_callback_applied',
          resourceType: 'onboarding',
          resourceId: 'onboarding-42',
          metadata: {
            providerIdentity: 'mock-provider',
            connectorOrder: 2,
            outcome: 'persisted',
          },
        },
      ],
      meta: {
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
        },
      },
    });
    expect(result.items[0]).not.toHaveProperty('before');
    expect(result.items[0]).not.toHaveProperty('after');
    expect(result.items[0]).not.toHaveProperty('hashPrev');
    expect(result.items[0]).not.toHaveProperty('hashSelf');
    expect(result.items[0]).not.toHaveProperty('sensitive');
  });
});
