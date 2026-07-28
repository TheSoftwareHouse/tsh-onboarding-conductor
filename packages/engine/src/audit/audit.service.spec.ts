import { EntityManager } from 'typeorm';
import { AuditLogEntity } from './entity/audit-log.entity';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  const createManager = () => ({}) as EntityManager;

  it('writes submit transition facts and allowlisted metadata', async () => {
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
        sensitive: 'do-not-store',
      },
      before: { foo: 'bar' },
      after: { foo: 'baz' },
      hashPrev: 'prev',
      hashSelf: 'self',
    });
    repository.insert.mockResolvedValue(entity);

    const result = await sut.log(
      manager,
      {
        id: '01912345-6789-7abc-8def-0123456789aa',
        workflowId: 'passport-check',
        workflowVersion: 1,
        status: 'draft',
        currentStep: 'review',
      },
      {
        id: '01912345-6789-7abc-8def-0123456789aa',
        workflowId: 'passport-check',
        workflowVersion: 1,
        status: 'submitted',
        currentStep: 'await_account',
      },
      'await_account',
    );

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
      }),
    );
    expect(repository.insert).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
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
