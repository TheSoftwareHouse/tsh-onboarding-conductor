import { EntityManager } from 'typeorm';
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
    repository.findByFilters.mockResolvedValue([
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
    ]);

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
    });
    expect(result.items[0]).not.toHaveProperty('before');
    expect(result.items[0]).not.toHaveProperty('after');
    expect(result.items[0]).not.toHaveProperty('hashPrev');
    expect(result.items[0]).not.toHaveProperty('hashSelf');
    expect(result.items[0]).not.toHaveProperty('sensitive');
  });
});
