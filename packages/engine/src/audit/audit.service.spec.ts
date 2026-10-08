import { DataSource, EntityManager } from 'typeorm';
import { AuditLogEntity } from './entity/audit-log.entity';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';
import type {
  ApiFailureAuditMetadata,
  AuditEventStamp,
  AuditLifecycleMetadata,
  AuditOnboardingSnapshot,
  ConnectorFailureAuditMetadata,
  ConnectorOutcomeAuditMetadata,
  EncryptionAuditMetadata,
  RejectedAttemptAuditMetadata,
} from './audit.types';

describe('AuditService', () => {
  const createManager = () => ({}) as EntityManager;

  it('writes started lifecycle facts with a null prior snapshot and allowlisted metadata', async () => {
    const repository = {
      insert: jest.fn(),
      findByFilters: jest.fn(),
    } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
    const sut = new AuditService(repository as unknown as AuditRepository);
    const manager = createManager();
    const onboarding: AuditOnboardingSnapshot = {
      id: '01912345-6789-7abc-8def-0123456789aa',
      workflowId: 'passport-check',
      workflowVersion: 1,
      status: 'draft',
      currentStep: 'review',
      scores: { risk: 0 },
    };
    const expectedMetadata: AuditLifecycleMetadata = {
      workflowId: 'passport-check',
      workflowVersion: 1,
      appliedStep: 'await_account',
      fromStatus: null,
      toStatus: 'draft',
      fromCurrentStep: null,
      toCurrentStep: 'review',
      fromScores: null,
      toScores: { risk: 0 },
    };
    const entity = Object.assign(new AuditLogEntity(), {
      id: '01912345-6789-7abc-8def-0123456789ac',
      occurredAt: new Date('2026-07-21T10:00:00.000Z'),
      actorType: 'system',
      actorId: 'engine',
      action: 'onboarding.started',
      resourceType: 'onboarding',
      resourceId: '01912345-6789-7abc-8def-0123456789aa',
      metadata: expectedMetadata,
      before: null,
      after: { foo: 'bar' },
      hashPrev: null,
      hashSelf: null,
    });
    repository.insert.mockResolvedValue(entity);

    const result = await sut.log(manager, {
      action: 'onboarding.started',
      onboarding,
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
          fromScores: null,
          toScores: { risk: 0 },
        },
        before: null,
        after: {
          id: '01912345-6789-7abc-8def-0123456789aa',
          workflowId: 'passport-check',
          workflowVersion: 1,
          status: 'draft',
          currentStep: 'review',
          scores: { risk: 0 },
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
        fromScores: { risk: 0 },
        toScores: { risk: 40 },
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
        scores: { risk: 0 },
      },
      newOnboarding: {
        id: '01912345-6789-7abc-8def-0123456789aa',
        workflowId: 'passport-check',
        workflowVersion: 1,
        status: 'submitted',
        currentStep: 'await_account',
        scores: { risk: 40 },
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
          fromScores: { risk: 0 },
          toScores: { risk: 40 },
        },
        before: {
          id: '01912345-6789-7abc-8def-0123456789aa',
          workflowId: 'passport-check',
          workflowVersion: 1,
          status: 'draft',
          currentStep: 'review',
          scores: { risk: 0 },
        },
        after: {
          id: '01912345-6789-7abc-8def-0123456789aa',
          workflowId: 'passport-check',
          workflowVersion: 1,
          status: 'submitted',
          currentStep: 'await_account',
          scores: { risk: 40 },
        },
        hashPrev: null,
        hashSelf: null,
      }),
    );
    expect(result).toBe(entity);
  });

  it('the filtered metadata a caller reads back preserves fromScores and toScores for a state transition row', async () => {
    const repository = {
      insert: jest.fn(),
      findByFilters: jest.fn().mockResolvedValue({
        items: [
          Object.assign(new AuditLogEntity(), {
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
              fromScores: { risk: 0 },
              toScores: { risk: 40 },
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
      }),
    } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
    const sut = new AuditService(repository as unknown as AuditRepository);
    const manager = createManager();

    const result = await sut.list(manager, {
      actorType: 'system',
      action: 'onboarding.state_transition',
    } as never);

    expect(result.items[0].metadata).toEqual({
      workflowId: 'passport-check',
      workflowVersion: 1,
      appliedStep: 'await_account',
      fromStatus: 'draft',
      toStatus: 'submitted',
      fromCurrentStep: 'review',
      toCurrentStep: 'await_account',
      fromScores: { risk: 0 },
      toScores: { risk: 40 },
    });
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
        fromScores: { risk: 40 },
        toScores: { risk: 40 },
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
        scores: { risk: 40 },
      },
      newOnboarding: {
        id: '01912345-6789-7abc-8def-0123456789aa',
        workflowId: 'passport-check',
        workflowVersion: 1,
        status: 'approved',
        currentStep: 'approved',
        scores: { risk: 40 },
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
          fromScores: { risk: 40 },
          toScores: { risk: 40 },
          manualTrigger: 'manual.approve',
        },
        before: {
          id: '01912345-6789-7abc-8def-0123456789aa',
          workflowId: 'passport-check',
          workflowVersion: 1,
          status: 'submitted',
          currentStep: 'await_account',
          scores: { risk: 40 },
        },
        after: {
          id: '01912345-6789-7abc-8def-0123456789aa',
          workflowId: 'passport-check',
          workflowVersion: 1,
          status: 'approved',
          currentStep: 'approved',
          scores: { risk: 40 },
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
    const expectedMetadata: RejectedAttemptAuditMetadata = {
      operation: 'submit',
      outcome: 'retryable_invalid_data',
    };

    await sut.logRejectedAttempt(dataSource, {
      ...expectedMetadata,
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
        metadata: expectedMetadata,
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
      metadata: {
        ingress: 'provider_callback',
        businessPayload: {
          nested: { id: 42, enabled: true },
          items: ['a', 'b'],
        },
        keepUnknownField: 'preserve-me',
      },
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
        submittedData: {
          identity: {
            firstName: 'Ada',
            lastName: 'Lovelace',
          },
        },
        connectorExecutionResult: {
          status: 'accepted',
          metadata: {
            score: 0.98,
          },
        },
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

  it('rejects unsupported webhook action/resource combinations before insert', async () => {
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

  it('projects complete webhook metadata without field filtering', async () => {
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
            businessPayload: {
              nested: { source: 'callback', token: 'abc123' },
              list: ['x', 'y'],
            },
            keepUnknownField: 'preserve-me',
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
            businessPayload: {
              nested: { source: 'callback', token: 'abc123' },
              list: ['x', 'y'],
            },
            keepUnknownField: 'preserve-me',
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
    expect(result.items[0]).toHaveProperty('metadata.businessPayload');
    expect(result.items[0]).toHaveProperty('metadata.keepUnknownField', 'preserve-me');
  });

  describe('admin access decisions', () => {
    function createSut() {
      const repository = {
        insert: jest.fn(),
        findByFilters: jest.fn(),
      } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
      const manager = createManager();
      const dataSource = {
        transaction: jest.fn(async (callback: (tx: EntityManager) => unknown) => callback(manager)),
      } as unknown as DataSource;

      return {
        repository,
        manager,
        dataSource,
        sut: new AuditService(repository as unknown as AuditRepository),
      };
    }

    it('writes a granted read against the operator, in its own transaction', async () => {
      const { sut, repository, manager, dataSource } = createSut();

      await sut.logAdminAccess(dataSource, {
        action: 'auth.access_granted',
        actorType: 'operator',
        actorId: '9f3c0000-0000-0000-0000-00000000000a',
        resourceId: '/v1/onboardings',
        metadata: {
          method: 'GET',
          tenantId: '11111111-1111-1111-1111-111111111111',
          userPrincipalName: 'anna.kowalska@tsh.io',
          grantedRoles: ['admin'],
        },
      });

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(repository.insert).toHaveBeenCalledWith(manager, {
        actorType: 'operator',
        actorId: '9f3c0000-0000-0000-0000-00000000000a',
        action: 'auth.access_granted',
        entryType: 'success',
        resourceType: 'admin_endpoint',
        resourceId: '/v1/onboardings',
        metadata: {
          method: 'GET',
          tenantId: '11111111-1111-1111-1111-111111111111',
          userPrincipalName: 'anna.kowalska@tsh.io',
          grantedRoles: ['admin'],
        },
        before: null,
        after: null,
        hashPrev: null,
        hashSelf: null,
      });
    });

    it('leaves the operator fields off a refusal rather than storing empty ones', async () => {
      // A null upn on a denial row would read as though an identity had been established.
      const { sut, repository, manager } = createSut();
      const dataSource = {
        transaction: jest.fn(async (callback: (tx: EntityManager) => unknown) => callback(manager)),
      } as unknown as DataSource;

      await sut.logAdminAccess(dataSource, {
        action: 'auth.token_rejected',
        actorType: 'anonymous',
        actorId: 'unknown',
        resourceId: '/v1/admin/audit',
        metadata: {
          method: 'GET',
          reason: 'unexpected "iss" claim value',
          tokenIssuer: 'https://sts.windows.net/tenant/',
          tokenAudience: null,
          tokenVersion: null,
        },
      });

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          metadata: {
            method: 'GET',
            reason: 'unexpected "iss" claim value',
            tokenIssuer: 'https://sts.windows.net/tenant/',
          },
        }),
      );
    });

    it('drops a metadata field the allowlist does not name', async () => {
      const { sut, repository, manager, dataSource } = createSut();

      await sut.logAdminAccess(dataSource, {
        action: 'auth.access_unauthenticated',
        actorType: 'anonymous',
        actorId: 'unknown',
        resourceId: '/v1/onboardings',
        metadata: { method: 'GET', authorizationHeader: 'Bearer secret' } as never,
      });

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ metadata: { method: 'GET' } }),
      );
    });

    it('names an actor rather than storing a blank one', async () => {
      const { sut, repository, manager, dataSource } = createSut();

      await sut.logAdminAccess(dataSource, {
        action: 'auth.access_granted',
        actorType: 'operator',
        actorId: '',
        resourceId: '/v1/onboardings',
        metadata: { method: 'GET' },
      });

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ actorId: 'unknown' }),
      );
    });

    it.each([
      ['auth.access_granted', 'anonymous'],
      ['auth.role_missing', 'anonymous'],
      ['auth.token_rejected', 'operator'],
      ['auth.verification_unavailable', 'operator'],
      ['auth.access_unauthenticated', 'operator'],
    ])(
      'refuses to record %s as %s, which would misattribute the request',
      async (action, actorType) => {
        const { sut, repository, dataSource } = createSut();

        await expect(
          sut.logAdminAccess(dataSource, {
            action,
            actorType,
            actorId: 'someone',
            resourceId: '/v1/onboardings',
            metadata: { method: 'GET' },
          } as never),
        ).rejects.toThrow(/Unsupported admin access audit mapping/);
        expect(repository.insert).not.toHaveBeenCalled();
        expect(dataSource.transaction).not.toHaveBeenCalled();
      },
    );

    it('rejects an action outside the admin access allowlist', async () => {
      const { sut, dataSource } = createSut();

      await expect(
        sut.logAdminAccess(dataSource, {
          action: 'auth.access_invented',
          actorType: 'operator',
          actorId: 'someone',
          resourceId: '/v1/onboardings',
          metadata: { method: 'GET' },
        } as never),
      ).rejects.toThrow(/Unsupported admin access audit action/);
    });

    it('returns admin access metadata through the list endpoint instead of lifecycle fields', async () => {
      // Without an explicit branch these rows would be squeezed through the lifecycle allowlist
      // and reach the operator as a row of undefined workflow fields.
      const repository = {
        insert: jest.fn(),
        findByFilters: jest.fn(),
      } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
      const sut = new AuditService(repository as unknown as AuditRepository);
      repository.findByFilters.mockResolvedValue({
        items: [
          Object.assign(new AuditLogEntity(), {
            id: '01912345-6789-7abc-8def-0123456789ad',
            occurredAt: new Date('2026-07-21T10:00:00.000Z'),
            actorType: 'operator',
            actorId: '9f3c0000-0000-0000-0000-00000000000a',
            action: 'auth.access_granted',
            resourceType: 'admin_endpoint',
            resourceId: '/v1/onboardings',
            metadata: {
              method: 'GET',
              tenantId: '11111111-1111-1111-1111-111111111111',
              userPrincipalName: 'anna.kowalska@tsh.io',
              grantedRoles: ['admin'],
              smuggledField: 'should-not-surface',
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

      const result = await sut.list(createManager());

      expect(result.items[0].metadata).toEqual({
        method: 'GET',
        tenantId: '11111111-1111-1111-1111-111111111111',
        userPrincipalName: 'anna.kowalska@tsh.io',
        grantedRoles: ['admin'],
      });
    });
  });
  describe('connector settings changes', () => {
    function createSut() {
      const repository = {
        insert: jest.fn(),
        findByFilters: jest.fn(),
      } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
      const manager = createManager();
      const dataSource = {
        transaction: jest.fn(async (callback: (tx: EntityManager) => unknown) => callback(manager)),
      } as unknown as DataSource;

      return {
        repository,
        manager,
        dataSource,
        sut: new AuditService(repository as unknown as AuditRepository),
      };
    }

    it('writes a settings-updated row against the connector type, in its own transaction', async () => {
      const { sut, repository, manager, dataSource } = createSut();

      await sut.logConnectorSettingsChange(dataSource, {
        action: 'connector_settings.updated',
        actorId: 'operator-oid',
        resourceId: 'sendgrid_email',
        metadata: { connectorId: 'sendgrid_email', keys: ['apiKey', 'from'] },
      });

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(repository.insert).toHaveBeenCalledWith(manager, {
        actorType: 'operator',
        actorId: 'operator-oid',
        action: 'connector_settings.updated',
        entryType: 'success',
        resourceType: 'connector_settings',
        resourceId: 'sendgrid_email',
        metadata: { connectorId: 'sendgrid_email', keys: ['apiKey', 'from'] },
        before: null,
        after: null,
        hashPrev: null,
        hashSelf: null,
      });
    });

    it('writes a settings-deleted row with an empty key list for a no-op delete', async () => {
      const { sut, repository, manager, dataSource } = createSut();

      await sut.logConnectorSettingsChange(dataSource, {
        action: 'connector_settings.deleted',
        actorId: 'unknown',
        resourceId: 'twilio_verify',
        metadata: { connectorId: 'twilio_verify', keys: [] },
      });

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          action: 'connector_settings.deleted',
          resourceType: 'connector_settings',
          metadata: { connectorId: 'twilio_verify', keys: [] },
        }),
      );
    });

    it('never carries a setting value, even if one were smuggled onto the metadata', async () => {
      const { sut, repository, dataSource } = createSut();
      const submittedSecret = 'sk-live-super-secret-value';

      await sut.logConnectorSettingsChange(dataSource, {
        action: 'connector_settings.updated',
        actorId: 'operator-oid',
        resourceId: 'sendgrid_email',
        metadata: {
          connectorId: 'sendgrid_email',
          keys: ['apiKey'],
          value: submittedSecret,
        } as never,
      });

      const insertedRow = repository.insert.mock.calls[0][1] as { metadata: unknown };
      expect(JSON.stringify(insertedRow.metadata)).not.toContain(submittedSecret);
      expect(insertedRow.metadata).toEqual({ connectorId: 'sendgrid_email', keys: ['apiKey'] });
    });

    it('names an actor rather than storing a blank one', async () => {
      const { sut, repository, manager, dataSource } = createSut();

      await sut.logConnectorSettingsChange(dataSource, {
        action: 'connector_settings.updated',
        actorId: '',
        resourceId: 'sendgrid_email',
        metadata: { connectorId: 'sendgrid_email', keys: ['apiKey'] },
      });

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ actorId: 'unknown' }),
      );
    });

    it('rejects an action outside the connector settings allowlist', async () => {
      const { sut, dataSource } = createSut();

      await expect(
        sut.logConnectorSettingsChange(dataSource, {
          action: 'connector_settings.invented',
          actorId: 'operator-oid',
          resourceId: 'sendgrid_email',
          metadata: { connectorId: 'sendgrid_email', keys: [] },
        } as never),
      ).rejects.toThrow(/Unsupported connector settings audit action/);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('returns connector settings metadata through the list endpoint instead of lifecycle fields', async () => {
      const repository = {
        insert: jest.fn(),
        findByFilters: jest.fn(),
      } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
      const sut = new AuditService(repository as unknown as AuditRepository);
      repository.findByFilters.mockResolvedValue({
        items: [
          Object.assign(new AuditLogEntity(), {
            id: '01912345-6789-7abc-8def-0123456789ae',
            occurredAt: new Date('2026-07-21T10:00:00.000Z'),
            actorType: 'operator',
            actorId: 'operator-oid',
            action: 'connector_settings.updated',
            resourceType: 'connector_settings',
            resourceId: 'sendgrid_email',
            metadata: {
              connectorId: 'sendgrid_email',
              keys: ['apiKey'],
              smuggledValue: 'sk-live-should-not-surface',
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

      const result = await sut.list(createManager());

      expect(result.items[0].metadata).toEqual({
        connectorId: 'sendgrid_email',
        keys: ['apiKey'],
      });
    });
  });

  describe('workflow connector selections', () => {
    function createSut() {
      const repository = {
        insert: jest.fn(),
        findByFilters: jest.fn(),
      } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
      const manager = createManager();
      const dataSource = {
        transaction: jest.fn(async (callback: (tx: EntityManager) => unknown) => callback(manager)),
      } as unknown as DataSource;

      return {
        repository,
        manager,
        dataSource,
        sut: new AuditService(repository as unknown as AuditRepository),
      };
    }

    it('writes a selection row against the workflow type, in its own transaction', async () => {
      const { sut, repository, manager, dataSource } = createSut();

      await sut.logWorkflowChange(dataSource, {
        action: 'workflow.connector_selected',
        actorId: 'operator-oid',
        resourceId: 'eu-b2c',
        metadata: {
          workflowId: 'eu-b2c',
          stepName: 'submit_kyc',
          previousConnectorId: null,
          connectorId: 'veriff_kyc',
        },
      });

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(repository.insert).toHaveBeenCalledWith(manager, {
        actorType: 'operator',
        actorId: 'operator-oid',
        action: 'workflow.connector_selected',
        entryType: 'success',
        resourceType: 'workflow',
        resourceId: 'eu-b2c',
        metadata: {
          workflowId: 'eu-b2c',
          stepName: 'submit_kyc',
          previousConnectorId: null,
          connectorId: 'veriff_kyc',
        },
        before: null,
        after: null,
        hashPrev: null,
        hashSelf: null,
      });
    });

    it('writes a cleared row with a null connector and names an actor rather than a blank one', async () => {
      const { sut, repository, manager, dataSource } = createSut();

      await sut.logWorkflowChange(dataSource, {
        action: 'workflow.connector_selection_cleared',
        actorId: '',
        resourceId: 'eu-b2c',
        metadata: {
          workflowId: 'eu-b2c',
          stepName: 'submit_kyc',
          previousConnectorId: 'veriff_kyc',
          connectorId: null,
        },
      });

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          actorId: 'unknown',
          action: 'workflow.connector_selection_cleared',
          metadata: expect.objectContaining({ connectorId: null }),
        }),
      );
    });

    it('drops anything but the allowlisted metadata', async () => {
      const { sut, repository, dataSource } = createSut();

      await sut.logWorkflowChange(dataSource, {
        action: 'workflow.connector_selected',
        actorId: 'operator-oid',
        resourceId: 'eu-b2c',
        metadata: {
          workflowId: 'eu-b2c',
          stepName: 'submit_kyc',
          previousConnectorId: 'sumsub_kyc',
          connectorId: 'veriff_kyc',
          smuggled: 'x',
        } as never,
      });

      const insertedRow = repository.insert.mock.calls[0][1] as { metadata: unknown };
      expect(insertedRow.metadata).toEqual({
        workflowId: 'eu-b2c',
        stepName: 'submit_kyc',
        previousConnectorId: 'sumsub_kyc',
        connectorId: 'veriff_kyc',
      });
    });

    it('rejects an action outside the workflow allowlist', async () => {
      const { sut, dataSource } = createSut();

      await expect(
        sut.logWorkflowChange(dataSource, {
          action: 'workflow.invented',
          actorId: 'operator-oid',
          resourceId: 'eu-b2c',
          metadata: {
            workflowId: 'eu-b2c',
            stepName: 'submit_kyc',
            previousConnectorId: null,
            connectorId: null,
          },
        } as never),
      ).rejects.toThrow(/Unsupported workflow audit action/);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('returns the allowlisted metadata through the list endpoint', async () => {
      const { sut, repository } = createSut();
      repository.findByFilters.mockResolvedValue({
        items: [
          Object.assign(new AuditLogEntity(), {
            id: '01912345-6789-7abc-8def-0123456789af',
            occurredAt: new Date('2026-07-21T10:00:00.000Z'),
            actorType: 'operator',
            actorId: 'operator-oid',
            action: 'workflow.connector_selected',
            resourceType: 'workflow',
            resourceId: 'eu-b2c',
            metadata: {
              workflowId: 'eu-b2c',
              stepName: 'submit_kyc',
              previousConnectorId: null,
              connectorId: 'veriff_kyc',
              smuggled: 'x',
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

      const result = await sut.list(createManager());

      expect(result.items[0].metadata).toEqual({
        workflowId: 'eu-b2c',
        stepName: 'submit_kyc',
        previousConnectorId: null,
        connectorId: 'veriff_kyc',
      });
    });
  });

  describe('connector failure decisions', () => {
    function createSut() {
      const repository = {
        insert: jest.fn(),
        findByFilters: jest.fn(),
      } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
      const manager = createManager();
      const dataSource = {
        transaction: jest.fn(async (callback: (tx: EntityManager) => unknown) => callback(manager)),
      } as unknown as DataSource;

      return {
        repository,
        manager,
        dataSource,
        sut: new AuditService(repository as unknown as AuditRepository),
      };
    }

    const baseMetadata: ConnectorFailureAuditMetadata = {
      stepName: 'send_notification',
      connectorId: 'sendgrid_email',
      connectorName: 'primary_email',
      connectorOrder: 1,
      errorHandler: 'retry_then_fallback',
      attempt: 1,
      status: 503,
      errorName: 'SendgridEmailUnavailableException',
    };
    const baseStamp: AuditEventStamp = {
      id: '01912345-6789-7abc-8def-0123456789ab',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    it.each([
      'connector.failure_retried',
      'connector.failure_fell_back',
      'connector.failure_ignored',
      'connector.failure_propagated',
    ] as const)(
      'writes a %s row against the onboarding, actored by the engine, in its own transaction',
      async (action) => {
        const { sut, repository, manager, dataSource } = createSut();

        await sut.logConnectorFailure(dataSource, {
          action,
          resourceId: '01912345-6789-7abc-8def-0123456789aa',
          metadata: baseMetadata,
          stamp: baseStamp,
        });

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(repository.insert).toHaveBeenCalledWith(manager, {
          actorType: 'system',
          actorId: 'engine',
          action,
          entryType: 'failed',
          resourceType: 'onboarding',
          resourceId: '01912345-6789-7abc-8def-0123456789aa',
          metadata: baseMetadata,
          before: null,
          after: null,
          hashPrev: null,
          hashSelf: null,
          stamp: baseStamp,
        });
      },
    );

    it('names the fallback taking over on a fell-back row', async () => {
      const { sut, repository, manager, dataSource } = createSut();

      await sut.logConnectorFailure(dataSource, {
        action: 'connector.failure_fell_back',
        resourceId: '01912345-6789-7abc-8def-0123456789aa',
        metadata: {
          ...baseMetadata,
          fallbackConnectorId: 'smtp',
          fallbackConnectorName: 'backup_email',
        },
        stamp: baseStamp,
      });

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          metadata: expect.objectContaining({
            fallbackConnectorId: 'smtp',
            fallbackConnectorName: 'backup_email',
          }),
        }),
      );
    });

    it('records the override when the executor could not honour the handler', async () => {
      const { sut, repository, manager, dataSource } = createSut();

      await sut.logConnectorFailure(dataSource, {
        action: 'connector.failure_propagated',
        resourceId: '01912345-6789-7abc-8def-0123456789aa',
        metadata: { ...baseMetadata, override: 'attempts_exhausted' },
        stamp: baseStamp,
      });

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          metadata: expect.objectContaining({ override: 'attempts_exhausted' }),
        }),
      );
    });

    it('drops a metadata field the allowlist does not name, including anything message-shaped', async () => {
      const { sut, repository, manager, dataSource } = createSut();

      await sut.logConnectorFailure(dataSource, {
        action: 'connector.failure_propagated',
        resourceId: '01912345-6789-7abc-8def-0123456789aa',
        metadata: {
          ...baseMetadata,
          errorMessage: 'settings key sendgrid_email.apiKey is not configured',
        } as never,
        stamp: baseStamp,
      });

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ metadata: baseMetadata }),
      );
      const insertedRow = repository.insert.mock.calls[0][1] as { metadata: unknown };
      expect(JSON.stringify(insertedRow.metadata)).not.toContain('settings key');
    });

    it('rejects an action outside the connector failure allowlist', async () => {
      const { sut, dataSource } = createSut();

      await expect(
        sut.logConnectorFailure(dataSource, {
          action: 'connector.failure_invented',
          resourceId: '01912345-6789-7abc-8def-0123456789aa',
          metadata: baseMetadata,
        } as never),
      ).rejects.toThrow(/Unsupported connector failure audit action/);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('returns connector failure metadata through the list endpoint instead of lifecycle fields', async () => {
      const repository = {
        insert: jest.fn(),
        findByFilters: jest.fn(),
      } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
      const sut = new AuditService(repository as unknown as AuditRepository);
      repository.findByFilters.mockResolvedValue({
        items: [
          Object.assign(new AuditLogEntity(), {
            id: '01912345-6789-7abc-8def-0123456789af',
            occurredAt: new Date('2026-07-21T10:00:00.000Z'),
            actorType: 'system',
            actorId: 'engine',
            action: 'connector.failure_fell_back',
            resourceType: 'onboarding',
            resourceId: '01912345-6789-7abc-8def-0123456789aa',
            metadata: {
              ...baseMetadata,
              fallbackConnectorId: 'smtp',
              fallbackConnectorName: 'backup_email',
              fallbackPosition: 2,
              retryDelayMs: 200,
              smuggledMessage: 'should-not-surface',
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

      const result = await sut.list(createManager());

      expect(result.items[0].metadata).toEqual({
        ...baseMetadata,
        fallbackConnectorId: 'smtp',
        fallbackConnectorName: 'backup_email',
        fallbackPosition: 2,
        retryDelayMs: 200,
      });
    });
  });

  describe('connector outcome decisions', () => {
    function createSut() {
      const repository = {
        insert: jest.fn(),
        findByFilters: jest.fn(),
      } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
      const manager = createManager();
      const dataSource = {
        transaction: jest.fn(async (callback: (tx: EntityManager) => unknown) => callback(manager)),
      } as unknown as DataSource;

      return {
        repository,
        manager,
        dataSource,
        sut: new AuditService(repository as unknown as AuditRepository),
      };
    }

    const baseMetadata: ConnectorOutcomeAuditMetadata = {
      stepName: 'verify_identity',
      connectorId: 'twilio_verify',
      connectorName: 'primary_sms',
      connectorOrder: 1,
    };
    const baseStamp: AuditEventStamp = {
      id: '01912345-6789-7abc-8def-0123456789ad',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    it.each([
      ['connector.execution_unavailable', 'failed'],
      ['connector.result_rejected', 'rejected'],
      ['connector.result_invalid_data', 'rejected'],
    ] as const)(
      'writes a %s row against the onboarding, actored by the engine, in its own transaction',
      async (action, entryType) => {
        const { sut, repository, manager, dataSource } = createSut();

        await sut.logConnectorOutcome(dataSource, {
          action,
          resourceId: '01912345-6789-7abc-8def-0123456789aa',
          metadata: baseMetadata,
          stamp: baseStamp,
        });

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(repository.insert).toHaveBeenCalledWith(manager, {
          actorType: 'system',
          actorId: 'engine',
          action,
          entryType,
          resourceType: 'onboarding',
          resourceId: '01912345-6789-7abc-8def-0123456789aa',
          metadata: baseMetadata,
          before: null,
          after: null,
          hashPrev: null,
          hashSelf: null,
          stamp: baseStamp,
        });
      },
    );

    it('keeps errorName, reason and fieldErrors when present', async () => {
      const { sut, repository, manager, dataSource } = createSut();

      await sut.logConnectorOutcome(dataSource, {
        action: 'connector.result_invalid_data',
        resourceId: '01912345-6789-7abc-8def-0123456789aa',
        metadata: {
          ...baseMetadata,
          reason: 'CHALLENGE_NOT_FOUND',
          fieldErrors: { code: ['INVALID'] },
        },
        stamp: baseStamp,
      });

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          metadata: expect.objectContaining({
            reason: 'CHALLENGE_NOT_FOUND',
            fieldErrors: { code: ['INVALID'] },
          }),
        }),
      );
    });

    it('drops a metadata field the allowlist does not name, including anything message-shaped', async () => {
      const { sut, repository, manager, dataSource } = createSut();

      await sut.logConnectorOutcome(dataSource, {
        action: 'connector.execution_unavailable',
        resourceId: '01912345-6789-7abc-8def-0123456789aa',
        metadata: {
          ...baseMetadata,
          errorMessage: 'connector adapter twilio_verify is not registered',
        } as never,
        stamp: baseStamp,
      });

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ metadata: baseMetadata }),
      );
      const insertedRow = repository.insert.mock.calls[0][1] as { metadata: unknown };
      expect(JSON.stringify(insertedRow.metadata)).not.toContain('is not registered');
    });

    it('rejects an action outside the connector outcome allowlist', async () => {
      const { sut, dataSource } = createSut();

      await expect(
        sut.logConnectorOutcome(dataSource, {
          action: 'connector.outcome_invented',
          resourceId: '01912345-6789-7abc-8def-0123456789aa',
          metadata: baseMetadata,
          stamp: baseStamp,
        } as never),
      ).rejects.toThrow(/Unsupported connector outcome audit action/);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('returns connector outcome metadata through the list endpoint instead of lifecycle fields', async () => {
      const repository = {
        insert: jest.fn(),
        findByFilters: jest.fn(),
      } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
      const sut = new AuditService(repository as unknown as AuditRepository);
      repository.findByFilters.mockResolvedValue({
        items: [
          Object.assign(new AuditLogEntity(), {
            id: '01912345-6789-7abc-8def-0123456789af',
            occurredAt: new Date('2026-07-21T10:00:00.000Z'),
            actorType: 'system',
            actorId: 'engine',
            action: 'connector.result_rejected',
            resourceType: 'onboarding',
            resourceId: '01912345-6789-7abc-8def-0123456789aa',
            metadata: {
              ...baseMetadata,
              reason: 'CONNECTOR_REJECTED',
              smuggledMessage: 'should-not-surface',
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

      const result = await sut.list(createManager());

      expect(result.items[0].metadata).toEqual({
        ...baseMetadata,
        reason: 'CONNECTOR_REJECTED',
      });
    });
  });

  describe('api failures', () => {
    function createSut() {
      const repository = {
        insert: jest.fn(),
        findByFilters: jest.fn(),
      } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
      const manager = createManager();
      const dataSource = {
        transaction: jest.fn(async (callback: (tx: EntityManager) => unknown) => callback(manager)),
      } as unknown as DataSource;

      return {
        repository,
        manager,
        dataSource,
        sut: new AuditService(repository as unknown as AuditRepository),
      };
    }

    const baseMetadata: ApiFailureAuditMetadata = {
      method: 'POST',
      route: 'POST /v1/onboardings/:id/documents',
      status: 404,
      code: 'ONBOARDING_NOT_FOUND',
      errorName: 'OnboardingNotFoundException',
    };
    const baseStamp: AuditEventStamp = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    it.each([
      ['api.request_rejected', 404, 'rejected'],
      ['api.request_failed', 500, 'failed'],
    ] as const)(
      'writes a %s row against the api endpoint, in its own transaction',
      async (action, status, entryType) => {
        const { sut, repository, manager, dataSource } = createSut();

        await sut.logApiFailure(dataSource, {
          action,
          actorType: 'anonymous',
          actorId: 'unknown',
          resourceId: baseMetadata.route,
          metadata: { ...baseMetadata, status },
          stamp: baseStamp,
        });

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(repository.insert).toHaveBeenCalledWith(manager, {
          actorType: 'anonymous',
          actorId: 'unknown',
          action,
          entryType,
          resourceType: 'api_endpoint',
          resourceId: baseMetadata.route,
          metadata: { ...baseMetadata, status },
          before: null,
          after: null,
          hashPrev: null,
          hashSelf: null,
          stamp: baseStamp,
        });
      },
    );

    it('records the operator identity when the request carried verified admin claims', async () => {
      const { sut, repository, manager, dataSource } = createSut();

      await sut.logApiFailure(dataSource, {
        action: 'api.request_rejected',
        actorType: 'operator',
        actorId: 'a@tsh.io',
        resourceId: baseMetadata.route,
        metadata: baseMetadata,
        stamp: baseStamp,
      });

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ actorType: 'operator', actorId: 'a@tsh.io' }),
      );
    });

    it('keeps routeParams and fieldErrors when present', async () => {
      const { sut, repository, manager, dataSource } = createSut();

      await sut.logApiFailure(dataSource, {
        action: 'api.request_rejected',
        actorType: 'anonymous',
        actorId: 'unknown',
        resourceId: baseMetadata.route,
        metadata: {
          ...baseMetadata,
          routeParams: { id: '01912345-6789-7abc-8def-0123456789aa' },
          fieldErrors: { email: ['isEmail'] },
        },
        stamp: baseStamp,
      });

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          metadata: expect.objectContaining({
            routeParams: { id: '01912345-6789-7abc-8def-0123456789aa' },
            fieldErrors: { email: ['isEmail'] },
          }),
        }),
      );
    });

    it('drops a metadata field the allowlist does not name, including anything message-shaped', async () => {
      const { sut, repository, manager, dataSource } = createSut();

      await sut.logApiFailure(dataSource, {
        action: 'api.request_rejected',
        actorType: 'anonymous',
        actorId: 'unknown',
        resourceId: baseMetadata.route,
        metadata: { ...baseMetadata, errorMessage: 'Onboarding 123 was not found' } as never,
        stamp: baseStamp,
      });

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ metadata: baseMetadata }),
      );
      const insertedRow = repository.insert.mock.calls[0][1] as { metadata: unknown };
      expect(JSON.stringify(insertedRow.metadata)).not.toContain('was not found');
    });

    it('rejects an action outside the api failure allowlist', async () => {
      const { sut, dataSource } = createSut();

      await expect(
        sut.logApiFailure(dataSource, {
          action: 'api.request_invented',
          actorType: 'anonymous',
          actorId: 'unknown',
          resourceId: baseMetadata.route,
          metadata: baseMetadata,
          stamp: baseStamp,
        } as never),
      ).rejects.toThrow(/Unsupported api failure audit action/);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('returns api failure metadata through the list endpoint instead of lifecycle fields', async () => {
      const repository = {
        insert: jest.fn(),
        findByFilters: jest.fn(),
      } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
      const sut = new AuditService(repository as unknown as AuditRepository);
      repository.findByFilters.mockResolvedValue({
        items: [
          Object.assign(new AuditLogEntity(), {
            id: '01912345-6789-7abc-8def-0123456789af',
            occurredAt: new Date('2026-07-21T10:00:00.000Z'),
            actorType: 'anonymous',
            actorId: 'unknown',
            action: 'api.request_rejected',
            resourceType: 'api_endpoint',
            resourceId: baseMetadata.route,
            metadata: {
              ...baseMetadata,
              routeParams: { id: '01912345-6789-7abc-8def-0123456789aa' },
              smuggledMessage: 'should-not-surface',
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

      const result = await sut.list(createManager());

      expect(result.items[0].metadata).toEqual({
        ...baseMetadata,
        routeParams: { id: '01912345-6789-7abc-8def-0123456789aa' },
      });
    });
  });

  describe('agreement facts', () => {
    const AGREEMENT_ID = '01912345-6789-7abc-8def-0123456789b1';
    const ONBOARDING_ID = '01912345-6789-7abc-8def-0123456789b2';

    function createSut() {
      const repository = {
        insert: jest.fn(),
        findByFilters: jest.fn(),
      } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;

      return {
        repository,
        manager: createManager(),
        sut: new AuditService(repository as unknown as AuditRepository),
      };
    }

    it('files a published version against the agreement, naming the operator behind it', async () => {
      const { sut, repository, manager } = createSut();

      await sut.logAgreement(manager, {
        action: 'agreement.version_published',
        actorId: 'operator-oid',
        resourceId: AGREEMENT_ID,
        metadata: {
          key: 'eu-b2c-terms',
          type: 'terms_and_conditions',
          version: 2,
          linkedOnboardings: 7,
        },
      });

      expect(repository.insert).toHaveBeenCalledWith(manager, {
        actorType: 'operator',
        actorId: 'operator-oid',
        action: 'agreement.version_published',
        entryType: 'success',
        resourceType: 'agreement',
        resourceId: AGREEMENT_ID,
        metadata: {
          key: 'eu-b2c-terms',
          type: 'terms_and_conditions',
          version: 2,
          linkedOnboardings: 7,
        },
        before: null,
        after: null,
        hashPrev: null,
        hashSelf: null,
      });
    });

    it('names an actor rather than storing a blank one', async () => {
      const { sut, repository, manager } = createSut();

      await sut.logAgreement(manager, {
        action: 'agreement.version_published',
        actorId: '',
        resourceId: AGREEMENT_ID,
        metadata: {
          key: 'eu-b2c-terms',
          type: 'terms_and_conditions',
          version: 1,
          linkedOnboardings: 0,
        },
      });

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ actorId: 'unknown' }),
      );
    });

    it.each([
      ['agreement.linked', 'version_published'],
      ['agreement.accepted', 'step_submit'],
    ] as const)(
      'files %s against the onboarding it happened to, as the engine',
      async (action, origin) => {
        const { sut, repository, manager } = createSut();

        await sut.logAgreement(manager, {
          action,
          resourceId: ONBOARDING_ID,
          metadata: {
            agreementId: AGREEMENT_ID,
            key: 'eu-b2c-terms',
            version: 2,
            origin,
          },
        } as never);

        expect(repository.insert).toHaveBeenCalledWith(
          manager,
          expect.objectContaining({
            actorType: 'system',
            actorId: 'engine',
            action,
            resourceType: 'onboarding',
            resourceId: ONBOARDING_ID,
            metadata: {
              agreementId: AGREEMENT_ID,
              key: 'eu-b2c-terms',
              version: 2,
              origin,
            },
          }),
        );
      },
    );

    it("writes on the caller's manager so the row stands or falls with the link", async () => {
      const { sut, repository, manager } = createSut();

      await sut.logAgreement(manager, {
        action: 'agreement.linked',
        resourceId: ONBOARDING_ID,
        metadata: {
          agreementId: AGREEMENT_ID,
          key: 'eu-b2c-terms',
          version: 1,
          origin: 'onboarding_start',
        },
      });

      expect(repository.insert.mock.calls[0][0]).toBe(manager);
    });

    it('drops a field the metadata contract does not name', async () => {
      const { sut, repository, manager } = createSut();

      await sut.logAgreement(manager, {
        action: 'agreement.linked',
        resourceId: ONBOARDING_ID,
        metadata: {
          agreementId: AGREEMENT_ID,
          key: 'eu-b2c-terms',
          version: 1,
          origin: 'manual',
          documentBody: 'the whole agreement text',
        } as never,
      });

      const insertedRow = repository.insert.mock.calls[0][1] as { metadata: unknown };
      expect(insertedRow.metadata).toEqual({
        agreementId: AGREEMENT_ID,
        key: 'eu-b2c-terms',
        version: 1,
        origin: 'manual',
      });
    });

    it('rejects an action outside the agreement allowlist', async () => {
      const { sut, repository, manager } = createSut();

      await expect(
        sut.logAgreement(manager, {
          action: 'agreement.invented',
          resourceId: ONBOARDING_ID,
          metadata: {},
        } as never),
      ).rejects.toThrow(/Unsupported agreement audit action/);

      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('returns agreement metadata through the list endpoint instead of lifecycle fields', async () => {
      const { sut, repository } = createSut();
      repository.findByFilters.mockResolvedValue({
        items: [
          Object.assign(new AuditLogEntity(), {
            id: '01912345-6789-7abc-8def-0123456789b3',
            occurredAt: new Date('2026-07-21T10:00:00.000Z'),
            actorType: 'operator',
            actorId: 'operator-oid',
            action: 'agreement.version_published',
            resourceType: 'agreement',
            resourceId: AGREEMENT_ID,
            metadata: {
              key: 'eu-b2c-terms',
              type: 'terms_and_conditions',
              version: 2,
              linkedOnboardings: 7,
              smuggled: 'should-not-surface',
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

      const result = await sut.list(createManager());

      expect(result.items[0].metadata).toEqual({
        key: 'eu-b2c-terms',
        type: 'terms_and_conditions',
        version: 2,
        linkedOnboardings: 7,
      });
    });
  });

  describe('pending connector reconciles', () => {
    const ONBOARDING_ID = '01912345-6789-7abc-8def-0123456789c0';
    const createSut = () => {
      const repository = { insert: jest.fn().mockResolvedValue(undefined) };

      return {
        repository,
        manager: createManager(),
        sut: new AuditService(repository as unknown as AuditRepository),
      };
    };

    it('files an applied verdict against the onboarding, naming the operator who asked', async () => {
      const { sut, repository, manager } = createSut();

      await sut.logPendingConnectorReconcile(manager, {
        action: 'onboarding.pending_connector_reconciled',
        actorId: 'operator-oid',
        resourceId: ONBOARDING_ID,
        metadata: {
          connectorId: 'veriff_kyc',
          connectorOrder: 1,
          providerIdentity: 'veriff_kyc',
          submittedData: { kycOutcome: 'verified' },
          connectorExecutionResult: { status: 'accepted' },
        },
      });

      expect(repository.insert).toHaveBeenCalledWith(manager, {
        actorType: 'operator',
        actorId: 'operator-oid',
        action: 'onboarding.pending_connector_reconciled',
        entryType: 'success',
        resourceType: 'onboarding',
        resourceId: ONBOARDING_ID,
        metadata: {
          connectorId: 'veriff_kyc',
          connectorOrder: 1,
          providerIdentity: 'veriff_kyc',
          submittedData: { kycOutcome: 'verified' },
          connectorExecutionResult: { status: 'accepted' },
        },
        before: null,
        after: null,
        hashPrev: null,
        hashSelf: null,
      });
    });

    it('files an ask that changed nothing as observed, with the reason', async () => {
      const { sut, repository, manager } = createSut();

      await sut.logPendingConnectorReconcile(manager, {
        action: 'onboarding.pending_connector_reconcile_noop',
        actorId: '',
        resourceId: ONBOARDING_ID,
        metadata: { connectorId: 'veriff_kyc', connectorOrder: 1, outcome: 'still_pending' },
      });

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          actorType: 'operator',
          actorId: 'unknown',
          entryType: 'observed',
          metadata: { connectorId: 'veriff_kyc', connectorOrder: 1, outcome: 'still_pending' },
        }),
      );
    });
  });

  describe('encryption', () => {
    const KEY_ID = '01912345-6789-7abc-8def-0123456789c1';
    const PREVIOUS_KEY_ID = '01912345-6789-7abc-8def-0123456789c0';
    const ONBOARDING_ID = '01912345-6789-7abc-8def-0123456789d0';

    function createSut() {
      const repository = {
        insert: jest.fn(),
        findByFilters: jest.fn(),
      } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
      const manager = createManager();
      const dataSource = {
        transaction: jest.fn(async (callback: (tx: EntityManager) => unknown) => callback(manager)),
      } as unknown as DataSource;

      return {
        repository,
        manager,
        dataSource,
        sut: new AuditService(repository as unknown as AuditRepository),
      };
    }

    it('writes an encryption-enabled row against the operator, in its own transaction', async () => {
      const { sut, repository, manager, dataSource } = createSut();

      await sut.logEncryption(dataSource, {
        action: 'encryption.enabled',
        actorType: 'operator',
        actorId: 'operator-oid',
        resourceId: KEY_ID,
        metadata: { keyId: KEY_ID },
      });

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(repository.insert).toHaveBeenCalledWith(manager, {
        actorType: 'operator',
        actorId: 'operator-oid',
        action: 'encryption.enabled',
        entryType: 'success',
        resourceType: 'encryption_key',
        resourceId: KEY_ID,
        metadata: { keyId: KEY_ID },
        before: null,
        after: null,
        hashPrev: null,
        hashSelf: null,
      });
    });

    it('writes a key-added row against the operator who requested it', async () => {
      const { sut, repository, manager, dataSource } = createSut();

      await sut.logEncryption(dataSource, {
        action: 'encryption.key_added',
        actorType: 'operator',
        actorId: 'operator-oid',
        resourceId: KEY_ID,
        metadata: { keyId: KEY_ID },
      });

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          actorType: 'operator',
          actorId: 'operator-oid',
          action: 'encryption.key_added',
          entryType: 'success',
          resourceType: 'encryption_key',
          metadata: { keyId: KEY_ID },
        }),
      );
    });

    it('writes a key-superseded row naming both the new and the superseded key', async () => {
      const { sut, repository, dataSource } = createSut();

      await sut.logEncryption(dataSource, {
        action: 'encryption.key_superseded',
        actorType: 'operator',
        actorId: 'operator-oid',
        resourceId: PREVIOUS_KEY_ID,
        metadata: { keyId: KEY_ID, supersededKeyId: PREVIOUS_KEY_ID },
      });

      expect(repository.insert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          metadata: { keyId: KEY_ID, supersededKeyId: PREVIOUS_KEY_ID },
        }),
      );
    });

    it.each([
      ['encryption.reencryption_started', { keyId: KEY_ID, rowsMoved: 42 }],
      ['encryption.reencryption_completed', { keyId: KEY_ID }],
      ['encryption.decryption_started', { keyId: KEY_ID, rowsMoved: 42 }],
      ['encryption.decryption_completed', { keyId: KEY_ID }],
      [
        'encryption.decryption_failed',
        { keyId: KEY_ID, onboardingId: ONBOARDING_ID, reason: 'EncryptionFailedError' },
      ],
    ] as const)('writes a %s row as the engine', async (action, metadata) => {
      const { sut, repository, dataSource } = createSut();

      await sut.logEncryption(dataSource, {
        action,
        actorType: 'system',
        actorId: 'engine',
        resourceId: KEY_ID,
        metadata,
      });

      expect(repository.insert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actorType: 'system', actorId: 'engine', action, metadata }),
      );
    });

    it('names an actor rather than storing a blank one', async () => {
      const { sut, repository, dataSource } = createSut();

      await sut.logEncryption(dataSource, {
        action: 'encryption.key_added',
        actorType: 'operator',
        actorId: '',
        resourceId: KEY_ID,
        metadata: { keyId: KEY_ID },
      });

      expect(repository.insert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actorId: 'unknown' }),
      );
    });

    it('rejects an action outside the encryption allowlist', async () => {
      const { sut, dataSource } = createSut();

      await expect(
        sut.logEncryption(dataSource, {
          action: 'encryption.invented',
          actorType: 'system',
          actorId: 'engine',
          resourceId: KEY_ID,
          metadata: {},
        } as never),
      ).rejects.toThrow(/Unsupported encryption audit action/);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('never carries key material, even if it were smuggled onto the metadata', async () => {
      const { sut, repository, dataSource } = createSut();
      const smuggledMaterial = 'base64-wrapped-key-bytes';

      await sut.logEncryption(dataSource, {
        action: 'encryption.key_added',
        actorType: 'operator',
        actorId: 'operator-oid',
        resourceId: KEY_ID,
        metadata: { keyId: KEY_ID, wrappedKey: smuggledMaterial } as never,
      });

      const insertedRow = repository.insert.mock.calls[0][1] as { metadata: unknown };
      expect(JSON.stringify(insertedRow.metadata)).not.toContain(smuggledMaterial);
      expect(insertedRow.metadata).toEqual({ keyId: KEY_ID });
    });

    it('drops a field the metadata contract does not name, dropping unset optional fields too', async () => {
      const { sut, repository, dataSource } = createSut();

      await sut.logEncryption(dataSource, {
        action: 'encryption.reencryption_failed',
        actorType: 'system',
        actorId: 'engine',
        resourceId: KEY_ID,
        metadata: {
          keyId: KEY_ID,
          reason: 'batch_timed_out',
          rawError: 'stack trace with a connection string in it',
        } as never,
      });

      const insertedRow = repository.insert.mock.calls[0][1] as { metadata: unknown };
      expect(insertedRow.metadata).toEqual({ keyId: KEY_ID, reason: 'batch_timed_out' });
    });

    it('classes the two failed sweep actions as failed and every other action as success', async () => {
      const entryTypes: Record<string, unknown> = {};
      const cases: ReadonlyArray<[string, EncryptionAuditMetadata]> = [
        ['encryption.enabled', { keyId: KEY_ID }],
        ['encryption.disabled', { keyId: KEY_ID }],
        ['encryption.key_added', { keyId: KEY_ID }],
        ['encryption.key_superseded', { keyId: KEY_ID, supersededKeyId: PREVIOUS_KEY_ID }],
        ['encryption.reencryption_started', { keyId: KEY_ID }],
        ['encryption.reencryption_completed', { keyId: KEY_ID }],
        ['encryption.reencryption_failed', { keyId: KEY_ID, reason: 'batch_timed_out' }],
        ['encryption.decryption_started', { keyId: KEY_ID }],
        ['encryption.decryption_completed', { keyId: KEY_ID }],
        ['encryption.decryption_failed', { keyId: KEY_ID, reason: 'batch_timed_out' }],
      ];

      for (const [action, metadata] of cases) {
        const { sut, repository, dataSource } = createSut();

        await sut.logEncryption(dataSource, {
          action,
          actorType: 'system',
          actorId: 'engine',
          resourceId: KEY_ID,
          metadata,
        } as never);

        entryTypes[action] = repository.insert.mock.calls[0][1].entryType;
      }

      expect(entryTypes).toEqual({
        'encryption.enabled': 'success',
        'encryption.disabled': 'success',
        'encryption.key_added': 'success',
        'encryption.key_superseded': 'success',
        'encryption.reencryption_started': 'success',
        'encryption.reencryption_completed': 'success',
        'encryption.reencryption_failed': 'failed',
        'encryption.decryption_started': 'success',
        'encryption.decryption_completed': 'success',
        'encryption.decryption_failed': 'failed',
      });
    });

    it('returns encryption metadata through the list endpoint instead of lifecycle fields', async () => {
      const repository = {
        insert: jest.fn(),
        findByFilters: jest.fn(),
      } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
      const sut = new AuditService(repository as unknown as AuditRepository);
      repository.findByFilters.mockResolvedValue({
        items: [
          Object.assign(new AuditLogEntity(), {
            id: '01912345-6789-7abc-8def-0123456789c2',
            occurredAt: new Date('2026-07-21T10:00:00.000Z'),
            actorType: 'operator',
            actorId: 'operator-oid',
            action: 'encryption.key_added',
            resourceType: 'encryption_key',
            resourceId: KEY_ID,
            metadata: {
              keyId: KEY_ID,
              wrappedKey: 'should-not-surface',
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

      const result = await sut.list(createManager());

      expect(result.items[0].metadata).toEqual({ keyId: KEY_ID });
    });
  });

  describe('listOnboardingLifecycle', () => {
    const lifecycleRow = (id: string, extra: Record<string, unknown> = {}) =>
      ({
        id,
        occurredAt: new Date('2026-07-01T10:00:00.000Z'),
        action: 'onboarding.state_transition',
        metadata: {
          workflowId: 'passport-check',
          workflowVersion: 1,
          appliedStep: 'review',
          fromStatus: 'awaiting_user',
          toStatus: 'awaiting_manual_review',
          fromCurrentStep: 'collect',
          toCurrentStep: 'review',
          ...extra,
        },
      }) as unknown as AuditLogEntity;

    const createService = (rows: AuditLogEntity[]) => {
      const repository = {
        findOnboardingLifecycle: jest.fn().mockResolvedValue(rows),
      } as unknown as jest.Mocked<Pick<AuditRepository, 'findOnboardingLifecycle'>>;

      return {
        repository,
        sut: new AuditService(repository as unknown as AuditRepository),
      };
    };

    it('answers oldest first, whichever order the rows were read in', async () => {
      const { sut, repository } = createService([lifecycleRow('c'), lifecycleRow('b')]);

      const trail = await sut.listOnboardingLifecycle(createManager(), 'onboarding-id', 10);

      expect(trail.entries.map((entry) => entry.id)).toEqual(['b', 'c']);
      expect(repository.findOnboardingLifecycle).toHaveBeenCalledWith(
        expect.anything(),
        'onboarding-id',
        10,
      );
    });

    it('reports a trail longer than the cap as clipped, keeping the most recent moves', async () => {
      const { sut } = createService([lifecycleRow('c'), lifecycleRow('b'), lifecycleRow('a')]);

      const trail = await sut.listOnboardingLifecycle(createManager(), 'onboarding-id', 2);

      expect(trail.truncated).toBe(true);
      expect(trail.entries.map((entry) => entry.id)).toEqual(['b', 'c']);
    });

    it('reports a trail that fits as complete', async () => {
      const { sut } = createService([lifecycleRow('a')]);

      await expect(
        sut.listOnboardingLifecycle(createManager(), 'onboarding-id', 2),
      ).resolves.toMatchObject({ truncated: false });
    });

    it('allowlists the metadata so a row from an older build cannot surface unknown fields', async () => {
      const { sut } = createService([lifecycleRow('a', { secret: 'leaked' })]);

      const trail = await sut.listOnboardingLifecycle(createManager(), 'onboarding-id', 10);

      expect(trail.entries[0].metadata).not.toHaveProperty('secret');
      expect(trail.entries[0].metadata.toCurrentStep).toBe('review');
    });
  });

  describe('entry types', () => {
    /**
     * Each action declares the kind of record it writes beside itself, in its family's table in
     * `audit.types.ts`; the family's `log*` method passes that declaration to the insert. These
     * cover one action per class rather than every action - the table's own keys are the action
     * type, so an unclassified action cannot be written in the first place.
     */
    function createSut() {
      const repository = {
        insert: jest.fn(),
        findByFilters: jest.fn(),
      } as unknown as jest.Mocked<Pick<AuditRepository, 'insert' | 'findByFilters'>>;
      const manager = createManager();
      const dataSource = {
        transaction: jest.fn(async (callback: (tx: EntityManager) => unknown) => callback(manager)),
      } as unknown as DataSource;

      return {
        repository,
        manager,
        dataSource,
        sut: new AuditService(repository as unknown as AuditRepository),
      };
    }

    const entryTypeOfLastInsert = (
      repository: jest.Mocked<Pick<AuditRepository, 'insert'>>,
    ): unknown => {
      const calls = repository.insert.mock.calls;

      return calls[calls.length - 1][1].entryType;
    };

    it('classes a lifecycle move as a success', async () => {
      const { sut, repository, manager } = createSut();

      await sut.log(manager, {
        action: 'onboarding.started',
        onboarding: {
          id: '01912345-6789-7abc-8def-0123456789aa',
          workflowId: 'passport-check',
          workflowVersion: 1,
          status: 'draft',
          currentStep: 'review',
          scores: {},
        },
        appliedStep: null,
      });

      expect(entryTypeOfLastInsert(repository)).toBe('success');
    });

    it('classes a submit the engine refused as rejected, not failed', async () => {
      // A 4xx is not an incident and a 5xx is; folding them together would bury real failures
      // under routine client mistakes.
      const { sut, repository, dataSource } = createSut();

      await sut.logRejectedAttempt(dataSource, {
        operation: 'submit',
        outcome: 'retryable_invalid_data',
        resourceId: '01912345-6789-7abc-8def-0123456789aa',
      });

      expect(entryTypeOfLastInsert(repository)).toBe('rejected');
    });

    it.each([
      ['webhook.outbound_delivery_succeeded', 'client_webhook_outbox', 'success'],
      ['webhook.inbound_callback_rejected', 'provider_callback', 'rejected'],
      ['webhook.outbound_delivery_failed', 'client_webhook_outbox', 'failed'],
      ['webhook.inbound_signature_skipped', 'provider_callback', 'observed'],
    ] as const)('classes %s as %s', async (action, resourceType, entryType) => {
      const { sut, repository, manager } = createSut();

      await sut.logWebhook(manager, {
        action,
        resourceType,
        resourceId: '01912345-6789-7abc-8def-0123456789aa',
        metadata: {},
      });

      expect(entryTypeOfLastInsert(repository)).toBe(entryType);
    });

    it('classes a token refusal as rejected and a verification outage as failed', async () => {
      const { sut, repository, dataSource } = createSut();

      await sut.logAdminAccess(dataSource, {
        action: 'auth.token_rejected',
        actorType: 'anonymous',
        actorId: 'unknown',
        resourceId: '/v1/onboardings',
        metadata: { method: 'GET' },
      });
      expect(entryTypeOfLastInsert(repository)).toBe('rejected');

      await sut.logAdminAccess(dataSource, {
        action: 'auth.verification_unavailable',
        actorType: 'anonymous',
        actorId: 'unknown',
        resourceId: '/v1/onboardings',
        metadata: { method: 'GET' },
      });
      expect(entryTypeOfLastInsert(repository)).toBe('failed');
    });

    it('classes an admin read served with no credential demanded as observed', async () => {
      // The local escape hatch is neither a success worth reporting nor a failure: its presence
      // in the trail is itself the finding.
      const { sut, repository, dataSource } = createSut();

      await sut.logAdminAccess(dataSource, {
        action: 'auth.access_unauthenticated',
        actorType: 'anonymous',
        actorId: 'unknown',
        resourceId: '/v1/onboardings',
        metadata: { method: 'GET' },
      });

      expect(entryTypeOfLastInsert(repository)).toBe('observed');
    });
  });
});
