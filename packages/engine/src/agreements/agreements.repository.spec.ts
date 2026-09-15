import { EntityManager, Repository } from 'typeorm';
import { AgreementsRepository } from './agreements.repository';
import { AgreementEntity } from './entity/agreement.entity';

describe('AgreementsRepository', () => {
  const publishedAt = new Date('2026-09-01T10:00:00.000Z');
  const createdAt = new Date('2026-09-01T10:00:00.000Z');

  const createHarness = () => {
    const repositoryMock = {
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(),
    } as unknown as Repository<AgreementEntity>;
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn().mockReturnValue(repositoryMock),
    } as unknown as EntityManager;

    return { sut: new AgreementsRepository(), manager, repositoryMock };
  };

  const createQueryBuilderMock = (rows: AgreementEntity[], total: number) => {
    const countQueryBuilder = { getCount: jest.fn().mockResolvedValue(total) };

    return {
      andWhere: jest.fn().mockReturnThis(),
      clone: jest.fn().mockReturnValue(countQueryBuilder),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    };
  };

  describe('createNextVersion', () => {
    it('publishes the first version of a new family as version 1', async () => {
      const harness = createHarness();
      (harness.manager.query as jest.Mock).mockResolvedValue([
        {
          id: '01912345-6789-7abc-8def-0123456789aa',
          key: 'eu-b2c-terms',
          type: 'terms_and_conditions',
          version: 1,
          published_at: publishedAt,
          created_at: createdAt,
        },
      ]);

      const agreement = await harness.sut.createNextVersion(
        harness.manager,
        'eu-b2c-terms',
        'terms_and_conditions',
      );

      expect(agreement).toBeInstanceOf(AgreementEntity);
      expect(agreement).toEqual(
        Object.assign(new AgreementEntity(), {
          id: '01912345-6789-7abc-8def-0123456789aa',
          key: 'eu-b2c-terms',
          type: 'terms_and_conditions',
          version: 1,
          publishedAt,
          createdAt,
        }),
      );

      const [sql] = (harness.manager.query as jest.Mock).mock.calls[0];
      expect(sql).toContain('INSERT INTO agreements');
      expect(sql).toContain('COALESCE(MAX(published.version), 0) + 1');
    });

    it('takes the next version of an existing family from MAX + 1 in the insert itself', async () => {
      const harness = createHarness();
      (harness.manager.query as jest.Mock).mockResolvedValue([
        {
          id: '01912345-6789-7abc-8def-0123456789ab',
          key: 'eu-b2c-terms',
          type: 'terms_and_conditions',
          version: 4,
          published_at: publishedAt,
          created_at: createdAt,
        },
      ]);

      const agreement = await harness.sut.createNextVersion(
        harness.manager,
        'eu-b2c-terms',
        'terms_and_conditions',
      );

      expect(agreement.version).toBe(4);
      expect(harness.manager.query).toHaveBeenCalledTimes(1);

      const [, parameters] = (harness.manager.query as jest.Mock).mock.calls[0];
      expect(parameters).toEqual([
        expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        'eu-b2c-terms',
        'terms_and_conditions',
      ]);
    });
  });

  describe('findLatestByKey', () => {
    it('reads the highest published version of the family', async () => {
      const harness = createHarness();
      const latest = Object.assign(new AgreementEntity(), {
        id: '01912345-6789-7abc-8def-0123456789ab',
        key: 'eu-b2c-terms',
        type: 'terms_and_conditions',
        version: 2,
        publishedAt,
        createdAt,
      });
      (harness.repositoryMock.findOne as jest.Mock).mockResolvedValue(latest);

      const agreement = await harness.sut.findLatestByKey(harness.manager, 'eu-b2c-terms');

      expect(harness.manager.getRepository).toHaveBeenCalledWith(AgreementEntity);
      expect(harness.repositoryMock.findOne).toHaveBeenCalledWith({
        where: { key: 'eu-b2c-terms' },
        order: { version: 'DESC' },
      });
      expect(agreement).toBe(latest);
    });

    it('returns undefined for a family with nothing published', async () => {
      const harness = createHarness();

      await expect(
        harness.sut.findLatestByKey(harness.manager, 'eu-b2c-terms'),
      ).resolves.toBeUndefined();
    });
  });

  describe('findLatestForKeys', () => {
    it('resolves the latest version of several families in one query', async () => {
      const harness = createHarness();
      (harness.manager.query as jest.Mock).mockResolvedValue([
        {
          id: '01912345-6789-7abc-8def-0123456789aa',
          key: 'eu-b2c-privacy',
          type: 'privacy_notice',
          version: 1,
          published_at: publishedAt,
          created_at: createdAt,
        },
        {
          id: '01912345-6789-7abc-8def-0123456789ab',
          key: 'eu-b2c-terms',
          type: 'terms_and_conditions',
          version: 3,
          published_at: publishedAt,
          created_at: createdAt,
        },
      ]);

      const latestByKey = await harness.sut.findLatestForKeys(harness.manager, [
        'eu-b2c-terms',
        'eu-b2c-privacy',
        'eu-b2c-marketing',
      ]);

      expect(harness.manager.query).toHaveBeenCalledTimes(1);

      const [sql, parameters] = (harness.manager.query as jest.Mock).mock.calls[0];
      expect(sql).toContain('DISTINCT ON (key)');
      expect(parameters).toEqual([['eu-b2c-terms', 'eu-b2c-privacy', 'eu-b2c-marketing']]);

      expect([...latestByKey.keys()].sort()).toEqual(['eu-b2c-privacy', 'eu-b2c-terms']);
      expect(latestByKey.get('eu-b2c-terms')).toEqual(
        Object.assign(new AgreementEntity(), {
          id: '01912345-6789-7abc-8def-0123456789ab',
          key: 'eu-b2c-terms',
          type: 'terms_and_conditions',
          version: 3,
          publishedAt,
          createdAt,
        }),
      );
      expect(latestByKey.has('eu-b2c-marketing')).toBe(false);
    });

    it('queries nothing when no key was asked for', async () => {
      const harness = createHarness();

      const latestByKey = await harness.sut.findLatestForKeys(harness.manager, []);

      expect(latestByKey.size).toBe(0);
      expect(harness.manager.query).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('reads one published version by id', async () => {
      const harness = createHarness();
      const agreement = Object.assign(new AgreementEntity(), {
        id: '01912345-6789-7abc-8def-0123456789aa',
        key: 'eu-b2c-terms',
        type: 'terms_and_conditions',
        version: 1,
        publishedAt,
        createdAt,
      });
      (harness.repositoryMock.findOne as jest.Mock).mockResolvedValue(agreement);

      await expect(
        harness.sut.findById(harness.manager, '01912345-6789-7abc-8def-0123456789aa'),
      ).resolves.toBe(agreement);
      expect(harness.repositoryMock.findOne).toHaveBeenCalledWith({
        where: { id: '01912345-6789-7abc-8def-0123456789aa' },
      });
    });

    it('returns undefined for an id matching no row', async () => {
      const harness = createHarness();

      await expect(
        harness.sut.findById(harness.manager, '01912345-6789-7abc-8def-0123456789ff'),
      ).resolves.toBeUndefined();
    });
  });

  describe('findForAdmin', () => {
    it('filters on key and type as bound parameters and orders versions newest first', async () => {
      const harness = createHarness();
      const rows = [Object.assign(new AgreementEntity(), { id: 'a' })];
      const queryBuilder = createQueryBuilderMock(rows, 1);
      (harness.repositoryMock.createQueryBuilder as jest.Mock).mockReturnValue(queryBuilder);

      const result = await harness.sut.findForAdmin(harness.manager, {
        key: 'eu-b2c-terms',
        type: 'terms_and_conditions',
      });

      expect(harness.repositoryMock.createQueryBuilder).toHaveBeenCalledWith('agreement');
      expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(1, 'agreement.key = :key', {
        key: 'eu-b2c-terms',
      });
      expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(2, 'agreement.type = :type', {
        type: 'terms_and_conditions',
      });
      expect(queryBuilder.orderBy).toHaveBeenCalledWith('agreement.key', 'ASC');
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('agreement.version', 'DESC');
      expect(queryBuilder.skip).toHaveBeenCalledWith(0);
      expect(queryBuilder.take).toHaveBeenCalledWith(20);
      expect(result).toEqual({ items: rows, total: 1, page: 1, limit: 20, totalPages: 1 });
    });

    it('applies no filter and the requested window when none was named', async () => {
      const harness = createHarness();
      const queryBuilder = createQueryBuilderMock([], 0);
      (harness.repositoryMock.createQueryBuilder as jest.Mock).mockReturnValue(queryBuilder);

      await harness.sut.findForAdmin(harness.manager, { page: 3, limit: 5 });

      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
      expect(queryBuilder.skip).toHaveBeenCalledWith(10);
      expect(queryBuilder.take).toHaveBeenCalledWith(5);
    });
  });
});
