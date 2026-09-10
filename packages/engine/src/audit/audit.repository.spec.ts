import { EntityManager, Repository } from 'typeorm';
import { AuditRepository } from './audit.repository';
import { AuditLogEntity } from './entity/audit-log.entity';

describe('AuditRepository', () => {
  const createHarness = () => {
    const repositoryMock = {
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
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
      entryType: 'success',
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
        entryType: 'success',
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

  it('takes both ordering columns from a stamp the caller supplies instead of stamping at write time', async () => {
    const harness = createHarness();
    (harness.repositoryMock.create as jest.Mock).mockReturnValue(new AuditLogEntity());
    (harness.repositoryMock.save as jest.Mock).mockResolvedValue(new AuditLogEntity());
    const stamp = {
      id: '01912345-6789-7abc-8def-0123456789ad',
      occurredAt: new Date('2026-07-21T10:00:00.000Z'),
    };

    await harness.sut.insert(harness.manager, {
      actorType: 'system',
      actorId: 'engine',
      action: 'connector.failure_fell_back',
      entryType: 'failed',
      resourceType: 'onboarding',
      resourceId: '01912345-6789-7abc-8def-0123456789aa',
      metadata: {},
      stamp,
    });

    expect(harness.repositoryMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: stamp.id, occurredAt: stamp.occurredAt }),
    );
  });

  it('returns audit rows in deterministic occurred_at desc and id desc order using parameterized filters', async () => {
    const filterCases: Array<{
      query: Record<string, string>;
      whereSql: string;
      params: Record<string, string>;
    }> = [
      {
        query: { actorType: 'system' },
        whereSql: 'audit_log.actorType = :actorType',
        params: { actorType: 'system' },
      },
      {
        query: { actorId: 'engine' },
        whereSql: 'audit_log.actorId = :actorId',
        params: { actorId: 'engine' },
      },
      {
        query: { action: 'onboarding.state_transition' },
        whereSql: 'audit_log.action = :action',
        params: { action: 'onboarding.state_transition' },
      },
      {
        query: { resourceType: 'onboarding' },
        whereSql: 'audit_log.resourceType = :resourceType',
        params: { resourceType: 'onboarding' },
      },
      {
        query: { resourceId: '01912345-6789-7abc-8def-0123456789aa' },
        whereSql: 'audit_log.resourceId = :resourceId',
        params: { resourceId: '01912345-6789-7abc-8def-0123456789aa' },
      },
    ];

    for (const filterCase of filterCases) {
      const harness = createHarness();
      const countQueryBuilder = {
        getCount: jest.fn().mockResolvedValue(0),
      };
      const queryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        clone: jest.fn().mockReturnValue(countQueryBuilder),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      (harness.repositoryMock.createQueryBuilder as jest.Mock).mockReturnValue(queryBuilder);

      await harness.sut.findByFilters(harness.manager, filterCase.query as never);

      expect(queryBuilder.andWhere).toHaveBeenCalledTimes(1);
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(filterCase.whereSql, filterCase.params);
      expect(queryBuilder.orderBy).toHaveBeenCalledWith('audit_log.occurredAt', 'DESC');
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('audit_log.id', 'DESC');
      expect(queryBuilder.skip).toHaveBeenCalledWith(0);
      expect(queryBuilder.take).toHaveBeenCalledWith(20);
    }
  });

  it('returns audit rows in deterministic occurred_at desc and id desc order using combined filters', async () => {
    const harness = createHarness();
    const rows = [
      Object.assign(new AuditLogEntity(), { id: 'a' }),
      Object.assign(new AuditLogEntity(), { id: 'b' }),
    ];
    const countQueryBuilder = {
      getCount: jest.fn().mockResolvedValue(12),
    };
    const queryBuilder = {
      andWhere: jest.fn().mockReturnThis(),
      clone: jest.fn().mockReturnValue(countQueryBuilder),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    };
    (harness.repositoryMock.createQueryBuilder as jest.Mock).mockReturnValue(queryBuilder);

    const result = await harness.sut.findByFilters(harness.manager, {
      actorType: 'system',
      actorId: 'engine',
      action: 'onboarding.state_transition',
      resourceType: 'onboarding',
      resourceId: '01912345-6789-7abc-8def-0123456789aa',
      occurredFrom: '2026-07-20T00:00:00.000Z',
      occurredTo: '2026-07-21T00:00:00.000Z',
    } as never);

    expect(harness.manager.getRepository).toHaveBeenCalledWith(AuditLogEntity);
    expect(harness.repositoryMock.createQueryBuilder).toHaveBeenCalledWith('audit_log');
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(1, 'audit_log.actorType = :actorType', {
      actorType: 'system',
    });
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(2, 'audit_log.actorId = :actorId', {
      actorId: 'engine',
    });
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(3, 'audit_log.action = :action', {
      action: 'onboarding.state_transition',
    });
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
      4,
      'audit_log.resourceType = :resourceType',
      {
        resourceType: 'onboarding',
      },
    );
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(5, 'audit_log.resourceId = :resourceId', {
      resourceId: '01912345-6789-7abc-8def-0123456789aa',
    });
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
      6,
      'audit_log.occurredAt >= :occurredFrom',
      {
        occurredFrom: '2026-07-20T00:00:00.000Z',
      },
    );
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
      7,
      'audit_log.occurredAt <= :occurredTo',
      {
        occurredTo: '2026-07-21T00:00:00.000Z',
      },
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('audit_log.occurredAt', 'DESC');
    expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('audit_log.id', 'DESC');
    expect(queryBuilder.skip).toHaveBeenCalledWith(0);
    expect(queryBuilder.take).toHaveBeenCalledWith(20);
    expect(result).toEqual({
      items: rows,
      total: 12,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  it('applies page and limit with offset and returns empty items for the last partial page', async () => {
    const harness = createHarness();
    const countQueryBuilder = {
      getCount: jest.fn().mockResolvedValue(21),
    };
    const queryBuilder = {
      andWhere: jest.fn().mockReturnThis(),
      clone: jest.fn().mockReturnValue(countQueryBuilder),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    (harness.repositoryMock.createQueryBuilder as jest.Mock).mockReturnValue(queryBuilder);

    const result = await harness.sut.findByFilters(harness.manager, {
      page: 3,
      limit: 10,
    } as never);

    expect(queryBuilder.skip).toHaveBeenCalledWith(20);
    expect(queryBuilder.take).toHaveBeenCalledWith(10);
    expect(result).toEqual({
      items: [],
      total: 21,
      page: 3,
      limit: 10,
      totalPages: 3,
    });
  });
});

describe('AuditRepository entry type', () => {
  it('writes the entry type it is handed rather than deriving one from the action', async () => {
    // Each action declares its entry type beside itself in `audit.types.ts` and the owning
    // `AuditService` method passes it through, so the repository never classifies anything.
    const created: Record<string, unknown>[] = [];
    const repositoryMock = {
      create: jest.fn((row: Record<string, unknown>) => {
        created.push(row);
        return row;
      }),
      save: jest.fn(async (row: unknown) => row),
      createQueryBuilder: jest.fn(),
    } as unknown as Repository<AuditLogEntity>;
    const manager = {
      getRepository: jest.fn().mockReturnValue(repositoryMock),
    } as unknown as EntityManager;

    await new AuditRepository().insert(manager, {
      actorType: 'system',
      actorId: 'engine',
      action: 'api.request_failed',
      entryType: 'failed',
      resourceType: 'api_endpoint',
      resourceId: 'GET /v1/onboardings',
      metadata: {},
    });

    expect(created[0].entryType).toBe('failed');
  });
});
