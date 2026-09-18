import { EntityManager, Repository } from 'typeorm';
import { AgreementsRepository } from './agreements.repository';
import { AgreementEntity } from './entity/agreement.entity';
import { AgreementVersionEntity } from './entity/agreement-version.entity';

describe('AgreementsRepository', () => {
  const publishedAt = new Date('2026-09-01T10:00:00.000Z');
  const createdAt = new Date('2026-09-01T10:00:00.000Z');

  const createHarness = () => {
    const agreementRepositoryMock = {
      findOne: jest.fn().mockResolvedValue(null),
    } as unknown as Repository<AgreementEntity>;
    const agreementVersionRepositoryMock = {
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(),
    } as unknown as Repository<AgreementVersionEntity>;
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn().mockImplementation((entity: unknown) => {
        if (entity === AgreementEntity) {
          return agreementRepositoryMock;
        }

        return agreementVersionRepositoryMock;
      }),
    } as unknown as EntityManager;

    return {
      sut: new AgreementsRepository(),
      manager,
      agreementRepositoryMock,
      agreementVersionRepositoryMock,
    };
  };

  const createQueryBuilderMock = (rows: AgreementVersionEntity[], total: number) => {
    const countQueryBuilder = { getCount: jest.fn().mockResolvedValue(total) };

    return {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
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
      (harness.manager.query as jest.Mock)
        .mockResolvedValueOnce(undefined) // family insert
        .mockResolvedValueOnce([{ id: 'agreement-1', type: 'terms_and_conditions' }]) // re-read the family id and type
        .mockResolvedValueOnce([
          {
            agreement_version_id: 'agreement-version-1',
            agreement_id: 'agreement-1',
            version: 1,
            published_at: publishedAt,
            created_at: createdAt,
          },
        ]) // version insert
        .mockResolvedValueOnce(undefined); // pointer update

      const agreement = await harness.sut.createNextVersion(
        harness.manager,
        'eu-b2c-terms',
        'terms_and_conditions',
      );

      expect(agreement).toBeInstanceOf(AgreementVersionEntity);
      expect(agreement.agreementVersionId).toBe('agreement-version-1');
      expect(agreement.version).toBe(1);
      expect(agreement.agreement).toEqual(
        Object.assign(new AgreementEntity(), {
          id: 'agreement-1',
          key: 'eu-b2c-terms',
          type: 'terms_and_conditions',
        }),
      );

      expect(harness.manager.query).toHaveBeenCalledTimes(4);

      const [familyInsertSql] = (harness.manager.query as jest.Mock).mock.calls[0];
      expect(familyInsertSql).toContain('INSERT INTO agreements');
      expect(familyInsertSql).toContain('ON CONFLICT ON CONSTRAINT uq_agreements_key DO NOTHING');

      const [reReadSql, reReadParameters] = (harness.manager.query as jest.Mock).mock.calls[1];
      expect(reReadSql).toContain('SELECT id, type FROM agreements WHERE key');
      expect(reReadParameters).toEqual(['eu-b2c-terms']);

      const [versionInsertSql, versionInsertParameters] = (harness.manager.query as jest.Mock).mock
        .calls[2];
      expect(versionInsertSql).toContain('INSERT INTO agreement_versions');
      expect(versionInsertSql).toContain('COALESCE(MAX(existing.version), 0) + 1');
      expect(versionInsertParameters[1]).toBe('agreement-1');

      const [pointerUpdateSql, pointerUpdateParameters] = (harness.manager.query as jest.Mock).mock
        .calls[3];
      expect(pointerUpdateSql).toContain('UPDATE agreements SET current_version_id');
      expect(pointerUpdateParameters).toEqual(['agreement-version-1', 'agreement-1']);
    });

    it('takes the next version of an existing family from MAX + 1 in the insert itself', async () => {
      const harness = createHarness();
      (harness.manager.query as jest.Mock)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ id: 'agreement-1', type: 'terms_and_conditions' }])
        .mockResolvedValueOnce([
          {
            agreement_version_id: 'agreement-version-4',
            agreement_id: 'agreement-1',
            version: 4,
            published_at: publishedAt,
            created_at: createdAt,
          },
        ])
        .mockResolvedValueOnce(undefined);

      const agreement = await harness.sut.createNextVersion(
        harness.manager,
        'eu-b2c-terms',
        'terms_and_conditions',
      );

      expect(agreement.version).toBe(4);
      expect(harness.manager.query).toHaveBeenCalledTimes(4);
    });

    it('sources the returned type from the stored family row, not the requested type', async () => {
      const harness = createHarness();
      (harness.manager.query as jest.Mock)
        .mockResolvedValueOnce(undefined) // family insert, no-op: the key already exists
        .mockResolvedValueOnce([{ id: 'agreement-1', type: 'terms_and_conditions' }]) // stored type wins the conflict
        .mockResolvedValueOnce([
          {
            agreement_version_id: 'agreement-version-2',
            agreement_id: 'agreement-1',
            version: 2,
            published_at: publishedAt,
            created_at: createdAt,
          },
        ])
        .mockResolvedValueOnce(undefined);

      const agreement = await harness.sut.createNextVersion(
        harness.manager,
        'eu-b2c-terms',
        'privacy_notice', // the caller's requested type disagrees with what is actually stored
      );

      expect(agreement.agreement.type).toBe('terms_and_conditions');
    });
  });

  describe('findFamilyByKey', () => {
    it('reads the family row directly by key', async () => {
      const harness = createHarness();
      const family = Object.assign(new AgreementEntity(), {
        id: 'agreement-1',
        key: 'eu-b2c-terms',
        type: 'terms_and_conditions',
      });
      (harness.agreementRepositoryMock.findOne as jest.Mock).mockResolvedValue(family);

      const result = await harness.sut.findFamilyByKey(harness.manager, 'eu-b2c-terms');

      expect(harness.manager.getRepository).toHaveBeenCalledWith(AgreementEntity);
      expect(harness.agreementRepositoryMock.findOne).toHaveBeenCalledWith({
        where: { key: 'eu-b2c-terms' },
      });
      expect(result).toBe(family);
    });

    it('returns a family that has no published version yet', async () => {
      const harness = createHarness();
      const family = Object.assign(new AgreementEntity(), {
        id: 'agreement-1',
        key: 'eu-b2c-terms',
        type: 'terms_and_conditions',
        currentVersion: null,
      });
      (harness.agreementRepositoryMock.findOne as jest.Mock).mockResolvedValue(family);

      const result = await harness.sut.findFamilyByKey(harness.manager, 'eu-b2c-terms');

      expect(result).toBe(family);
    });

    it('returns undefined when no family has this key', async () => {
      const harness = createHarness();

      await expect(
        harness.sut.findFamilyByKey(harness.manager, 'eu-b2c-terms'),
      ).resolves.toBeUndefined();
    });
  });

  describe('findLatestForKeys', () => {
    it('resolves the latest version of several families through the current-version pointer', async () => {
      const harness = createHarness();
      (harness.manager.query as jest.Mock).mockResolvedValue([
        {
          key: 'eu-b2c-privacy',
          type: 'privacy_notice',
          agreement_version_id: 'privacy-version-1',
          agreement_id: 'agreement-privacy',
          version: 1,
          published_at: publishedAt,
          created_at: createdAt,
        },
        {
          key: 'eu-b2c-terms',
          type: 'terms_and_conditions',
          agreement_version_id: 'agreement-version-3',
          agreement_id: 'agreement-1',
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
      expect(sql).toContain('agreement.current_version_id');
      expect(parameters).toEqual([['eu-b2c-terms', 'eu-b2c-privacy', 'eu-b2c-marketing']]);

      expect([...latestByKey.keys()].sort()).toEqual(['eu-b2c-privacy', 'eu-b2c-terms']);
      const terms = latestByKey.get('eu-b2c-terms');
      expect(terms?.version).toBe(3);
      expect(terms?.agreementVersionId).toBe('agreement-version-3');
      expect(terms?.agreement).toEqual(
        Object.assign(new AgreementEntity(), {
          id: 'agreement-1',
          key: 'eu-b2c-terms',
          type: 'terms_and_conditions',
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
    it('reads one published version by its own id, with its family loaded', async () => {
      const harness = createHarness();
      const version = Object.assign(new AgreementVersionEntity(), {
        agreementVersionId: 'agreement-version-1',
        agreementId: 'agreement-1',
        version: 1,
        publishedAt,
        createdAt,
      });
      (harness.agreementVersionRepositoryMock.findOne as jest.Mock).mockResolvedValue(version);

      await expect(harness.sut.findById(harness.manager, 'agreement-version-1')).resolves.toBe(
        version,
      );
      expect(harness.agreementVersionRepositoryMock.findOne).toHaveBeenCalledWith({
        where: { agreementVersionId: 'agreement-version-1' },
        relations: { agreement: true },
      });
    });

    it('returns undefined for an id matching no row', async () => {
      const harness = createHarness();

      await expect(harness.sut.findById(harness.manager, 'missing-id')).resolves.toBeUndefined();
    });
  });

  describe('findForAdmin', () => {
    it('filters on key and type as bound parameters and orders versions newest first', async () => {
      const harness = createHarness();
      const rows = [Object.assign(new AgreementVersionEntity(), { agreementVersionId: 'a' })];
      const queryBuilder = createQueryBuilderMock(rows, 1);
      (harness.agreementVersionRepositoryMock.createQueryBuilder as jest.Mock).mockReturnValue(
        queryBuilder,
      );

      const result = await harness.sut.findForAdmin(harness.manager, {
        key: 'eu-b2c-terms',
        type: 'terms_and_conditions',
      });

      expect(harness.agreementVersionRepositoryMock.createQueryBuilder).toHaveBeenCalledWith(
        'version',
      );
      expect(queryBuilder.innerJoinAndSelect).toHaveBeenCalledWith(
        'version.agreement',
        'agreement',
      );
      expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(1, 'agreement.key = :key', {
        key: 'eu-b2c-terms',
      });
      expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(2, 'agreement.type = :type', {
        type: 'terms_and_conditions',
      });
      expect(queryBuilder.orderBy).toHaveBeenCalledWith('agreement.key', 'ASC');
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('version.version', 'DESC');
      expect(queryBuilder.skip).toHaveBeenCalledWith(0);
      expect(queryBuilder.take).toHaveBeenCalledWith(20);
      expect(result).toEqual({ items: rows, total: 1, page: 1, limit: 20, totalPages: 1 });
    });

    it('applies no filter and the requested window when none was named', async () => {
      const harness = createHarness();
      const queryBuilder = createQueryBuilderMock([], 0);
      (harness.agreementVersionRepositoryMock.createQueryBuilder as jest.Mock).mockReturnValue(
        queryBuilder,
      );

      await harness.sut.findForAdmin(harness.manager, { page: 3, limit: 5 });

      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
      expect(queryBuilder.skip).toHaveBeenCalledWith(10);
      expect(queryBuilder.take).toHaveBeenCalledWith(5);
    });
  });
});
