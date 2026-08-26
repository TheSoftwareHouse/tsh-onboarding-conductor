import { DataSource, EntityManager } from 'typeorm';
import { AuditLogEntity } from './entity/audit-log.entity';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';
import type {
  AuditLifecycleMetadata,
  AuditOnboardingSnapshot,
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
    };
    const expectedMetadata: AuditLifecycleMetadata = {
      workflowId: 'passport-check',
      workflowVersion: 1,
      appliedStep: 'await_account',
      fromStatus: null,
      toStatus: 'draft',
      fromCurrentStep: null,
      toCurrentStep: 'review',
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
});
