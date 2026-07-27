import { EntityManager, Repository } from 'typeorm';
import { AuditRepository } from './audit.repository';
import { AuditLogEntity } from './entity/audit-log.entity';

describe('AuditRepository', () => {
  const createHarness = () => {
    const repositoryMock = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
    } as unknown as Repository<AuditLogEntity>;
    const manager = {
      getRepository: jest.fn().mockReturnValue(repositoryMock),
    } as unknown as EntityManager;

    return {
      sut: new AuditRepository(),
      manager,
      repositoryMock,
    };
  };

  it('inserts an audit log through the caller EntityManager using only the declared fields', async () => {
    const harness = createHarness();
    const created = Object.assign(new AuditLogEntity(), {
      id: '01912345-6789-7abc-8def-0123456789ac',
      occurredAt: new Date('2026-07-21T10:00:00.000Z'),
      actorType: 'system',
      actorId: 'engine',
      action: 'onboarding.state_transition',
      resourceType: 'onboarding',
      resourceId: '01912345-6789-7abc-8def-0123456789aa',
      metadata: { workflowId: 'passport-check', workflowVersion: 1 },
    });
    (harness.repositoryMock.create as jest.Mock).mockReturnValue(created);
    (harness.repositoryMock.save as jest.Mock).mockResolvedValue(created);

    const result = await harness.sut.insert(harness.manager, {
      actorType: 'system',
      actorId: 'engine',
      action: 'onboarding.state_transition',
      resourceType: 'onboarding',
      resourceId: '01912345-6789-7abc-8def-0123456789aa',
      metadata: { workflowId: 'passport-check', workflowVersion: 1 },
    });

    expect(harness.manager.getRepository).toHaveBeenCalledWith(AuditLogEntity);
    expect(harness.repositoryMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        actorType: 'system',
        actorId: 'engine',
        action: 'onboarding.state_transition',
        resourceType: 'onboarding',
        resourceId: '01912345-6789-7abc-8def-0123456789aa',
        metadata: { workflowId: 'passport-check', workflowVersion: 1 },
        before: null,
        after: null,
        hashPrev: null,
        hashSelf: null,
      }),
    );
    expect(harness.repositoryMock.save).toHaveBeenCalledWith(created);
    expect(result).toBe(created);
  });

  it('returns audit rows in deterministic occurred_at desc and id desc order', async () => {
    const harness = createHarness();
    const rows = [
      Object.assign(new AuditLogEntity(), { id: 'a' }),
      Object.assign(new AuditLogEntity(), { id: 'b' }),
    ];
    (harness.repositoryMock.find as jest.Mock).mockResolvedValue(rows);

    const result = await harness.sut.findAllOrderedByOccurredAtDescAndIdDesc(harness.manager);

    expect(harness.manager.getRepository).toHaveBeenCalledWith(AuditLogEntity);
    expect(harness.repositoryMock.find).toHaveBeenCalledWith({
      order: {
        occurredAt: 'DESC',
        id: 'DESC',
      },
    });
    expect(result).toBe(rows);
  });
});
