import { EntityManager } from 'typeorm';
import { OnboardingsRepository } from './onboardings.repository';
import { createListAdminOnboardingsQuery } from './testing/onboardings-service.harness';

/**
 * The admin list is read through a query builder, so these assert the SQL fragments the builder is
 * asked for rather than the rows that come back — the ordering and the score bounds are the parts
 * a unit test can pin without a database.
 */
describe('OnboardingsRepository.findForAdmin', () => {
  const createQueryBuilderMock = () => {
    const calls = {
      andWhere: [] as Array<[string, Record<string, unknown>]>,
      orderBy: [] as Array<[string, string, string | undefined]>,
      addOrderBy: [] as Array<[string, string]>,
    };
    const builder = {
      andWhere: jest.fn((clause: string, params: Record<string, unknown>) => {
        calls.andWhere.push([clause, params]);
        return builder;
      }),
      orderBy: jest.fn((column: string, direction: string, nulls?: string) => {
        calls.orderBy.push([column, direction, nulls]);
        return builder;
      }),
      addOrderBy: jest.fn((column: string, direction: string) => {
        calls.addOrderBy.push([column, direction]);
        return builder;
      }),
      skip: jest.fn(() => builder),
      take: jest.fn(() => builder),
      // `paginateQueryBuilder` counts on a clone so the count is not paged; the clone need only
      // answer `getCount`.
      clone: jest.fn(() => ({ getCount: jest.fn(async () => 0) })),
      getMany: jest.fn(async () => []),
      getManyAndCount: jest.fn(async () => [[], 0]),
    };

    return { builder, calls };
  };

  const runQuery = async (overrides: Parameters<typeof createListAdminOnboardingsQuery>[0]) => {
    const { builder, calls } = createQueryBuilderMock();
    const manager = {
      getRepository: () => ({ createQueryBuilder: () => builder }),
    } as unknown as EntityManager;

    await new OnboardingsRepository().findForAdmin(
      manager,
      createListAdminOnboardingsQuery(overrides),
    );

    return calls;
  };

  it('orders by creation date descending by default, exactly as it always has', async () => {
    const calls = await runQuery({});

    expect(calls.orderBy).toEqual([['onboarding.createdAt', 'DESC', 'NULLS LAST']]);
    expect(calls.addOrderBy).toEqual([['onboarding.id', 'DESC']]);
  });

  it('orders by score when asked, keeping the id tie-break that makes paging stable', async () => {
    const calls = await runQuery({ sortBy: 'score', sortDir: 'asc' });

    expect(calls.orderBy).toEqual([['onboarding.score', 'ASC', 'NULLS LAST']]);
    expect(calls.addOrderBy).toEqual([['onboarding.id', 'DESC']]);
  });

  it('orders by completion date, sending the rows that have none to the end either way', async () => {
    // Postgres would otherwise put the unfinished onboardings first on DESC, which is the opposite
    // of what "most recently completed" means to an operator.
    const descending = await runQuery({ sortBy: 'completedAt', sortDir: 'desc' });
    expect(descending.orderBy).toEqual([['onboarding.completedAt', 'DESC', 'NULLS LAST']]);

    const ascending = await runQuery({ sortBy: 'completedAt', sortDir: 'asc' });
    expect(ascending.orderBy).toEqual([['onboarding.completedAt', 'ASC', 'NULLS LAST']]);
  });

  it('applies the score bounds inclusively', async () => {
    const calls = await runQuery({ minScore: 40, maxScore: 80 });

    expect(calls.andWhere).toEqual([
      ['onboarding.score >= :minScore', { minScore: 40 }],
      ['onboarding.score <= :maxScore', { maxScore: 80 }],
    ]);
  });

  it('accepts a negative bound', async () => {
    const calls = await runQuery({ minScore: -30 });

    expect(calls.andWhere).toEqual([['onboarding.score >= :minScore', { minScore: -30 }]]);
  });

  it('adds no score predicate when neither bound is given', async () => {
    const calls = await runQuery({ status: 'approved' });

    expect(calls.andWhere.map(([clause]) => clause)).toEqual(['onboarding.status = :status']);
  });
});
