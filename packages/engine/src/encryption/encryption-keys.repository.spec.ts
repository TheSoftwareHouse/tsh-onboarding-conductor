import { EntityManager, IsNull, Repository } from 'typeorm';
import { EncryptionKeysRepository } from './encryption-keys.repository';
import { EncryptionKeyEntity } from './entity/encryption-key.entity';

describe('EncryptionKeysRepository', () => {
  const createHarness = () => {
    const entityRepositoryMock = {
      insert: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    } as unknown as Repository<EncryptionKeyEntity>;
    const query = jest.fn().mockResolvedValue([{ total: '0', pending: '0' }]);
    const manager = {
      getRepository: jest.fn().mockReturnValue(entityRepositoryMock),
      query,
    } as unknown as EntityManager;

    return { sut: new EncryptionKeysRepository(), manager, entityRepositoryMock, query };
  };

  it('inserts a newly wrapped key', async () => {
    const { sut, manager, entityRepositoryMock } = createHarness();
    const activatedAt = new Date('2026-01-01T00:00:00.000Z');

    await sut.insert(manager, {
      id: 'key-1',
      wrappedKey: 'wrapped-material',
      createdBy: 'operator@tsh.io',
      activatedAt,
    });

    expect(manager.getRepository).toHaveBeenCalledWith(EncryptionKeyEntity);
    expect(entityRepositoryMock.insert).toHaveBeenCalledWith({
      id: 'key-1',
      wrappedKey: 'wrapped-material',
      createdBy: 'operator@tsh.io',
      activatedAt,
    });
  });

  it('accepts a null createdBy', async () => {
    const { sut, manager, entityRepositoryMock } = createHarness();

    await sut.insert(manager, {
      id: 'key-1',
      wrappedKey: 'wrapped-material',
      createdBy: null,
      activatedAt: new Date(),
    });

    expect((entityRepositoryMock.insert as jest.Mock).mock.calls[0][0]).toMatchObject({
      createdBy: null,
    });
  });

  it('reads back the single row with a null deletedAt', async () => {
    const { sut, manager, entityRepositoryMock } = createHarness();

    await sut.findActive(manager);

    expect(entityRepositoryMock.findOne).toHaveBeenCalledWith({ where: { deletedAt: IsNull() } });
  });

  it('returns null when no key has ever been created', async () => {
    const { sut, manager } = createHarness();

    const result = await sut.findActive(manager);

    expect(result).toBeNull();
  });

  it('reads back one key by id', async () => {
    const { sut, manager, entityRepositoryMock } = createHarness();

    await sut.findById(manager, 'key-1');

    expect(entityRepositoryMock.findOne).toHaveBeenCalledWith({ where: { id: 'key-1' } });
  });

  it('reads back every key, most recent first', async () => {
    const { sut, manager, entityRepositoryMock } = createHarness();

    await sut.findAll(manager);

    expect(entityRepositoryMock.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } });
  });

  it('soft-deletes whichever row is currently active, at the caller-supplied instant', async () => {
    const { sut, manager, entityRepositoryMock } = createHarness();
    const deletedAt = new Date('2026-01-01T00:15:00.000Z');

    await sut.softDeleteActive(manager, deletedAt);

    expect(entityRepositoryMock.update).toHaveBeenCalledTimes(1);
    expect(entityRepositoryMock.update).toHaveBeenCalledWith(
      { deletedAt: IsNull() },
      { deletedAt },
    );
  });

  it('never touches wrappedKey when soft-deleting', async () => {
    const { sut, manager, entityRepositoryMock } = createHarness();

    await sut.softDeleteActive(manager, new Date());

    const [, patch] = (entityRepositoryMock.update as jest.Mock).mock.calls[0];
    expect(patch).not.toHaveProperty('wrappedKey');
  });

  describe('lockReEncryptionAudit', () => {
    it('takes a transaction-scoped advisory lock keyed on the action and the key id together', async () => {
      const { sut, manager, query } = createHarness();

      await sut.lockReEncryptionAudit(manager, 'encryption.reencryption_started', 'key-1');

      expect(query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'encryption.reencryption_started:key-1',
      ]);
    });

    it('locks a different key for started and completed on the same key id, so they cannot block each other', async () => {
      const { sut, manager, query } = createHarness();

      await sut.lockReEncryptionAudit(manager, 'encryption.reencryption_started', 'key-1');
      await sut.lockReEncryptionAudit(manager, 'encryption.reencryption_completed', 'key-1');

      const [[, firstParams], [, secondParams]] = query.mock.calls as [string, string[]][][];
      expect(firstParams).not.toEqual(secondParams);
    });
  });

  describe('hasPendingReEncryption', () => {
    it('binds the active key id and shares the predicate with the other pending queries', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([{ exists: false }]);

      await sut.hasPendingReEncryption(manager, 'key-2');

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('EXISTS');
      expect(sql).toContain("context ? '__tsh_enc' AND context ->> 'k' IS DISTINCT FROM $1");
      expect(params).toEqual(['key-2']);
    });

    it('returns true when a row is pending', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([{ exists: true }]);

      await expect(sut.hasPendingReEncryption(manager, 'key-2')).resolves.toBe(true);
    });

    it('returns false when nothing is pending', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([{ exists: false }]);

      await expect(sut.hasPendingReEncryption(manager, 'key-2')).resolves.toBe(false);
    });

    it('never runs an unconditional scan: the query always carries a WHERE clause', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([{ exists: false }]);

      await sut.hasPendingReEncryption(manager, 'key-2');

      const [sql] = query.mock.calls[0];
      expect(sql).toContain('WHERE');
    });
  });

  describe('countReEncryptionStatus', () => {
    it('queries onboardings with the active key id bound as a parameter', async () => {
      const { sut, manager, query } = createHarness();

      await sut.countReEncryptionStatus(manager, 'key-2');

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("context ? '__tsh_enc'");
      expect(sql).toContain("context ->> 'k' IS DISTINCT FROM $1");
      expect(params).toEqual(['key-2']);
    });

    it('coerces the counted rows to numbers', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([{ total: '7', pending: '3' }]);

      const result = await sut.countReEncryptionStatus(manager, 'key-2');

      expect(result).toEqual({ pending: 3, total: 7 });
    });

    it('reports zero for both when the query returns no row', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([]);

      const result = await sut.countReEncryptionStatus(manager, 'key-2');

      expect(result).toEqual({ pending: 0, total: 0 });
    });

    it('accepts a null active key id', async () => {
      const { sut, manager, query } = createHarness();

      await sut.countReEncryptionStatus(manager, null);

      const [, params] = query.mock.calls[0];
      expect(params).toEqual([null]);
    });
  });

  describe('claimPendingReEncryptionIds', () => {
    it('shares its predicate with countReEncryptionStatus, so the two can never drift', async () => {
      const { sut, manager, query } = createHarness();

      await sut.countReEncryptionStatus(manager, 'key-2');
      const [countSql] = query.mock.calls[0];

      query.mockClear();
      query.mockResolvedValue([]);
      await sut.claimPendingReEncryptionIds(manager, 'key-2', 10);
      const [claimSql] = query.mock.calls[0];

      expect(claimSql).toContain("context ? '__tsh_enc' AND context ->> 'k' IS DISTINCT FROM $1");
      expect(countSql).toContain("context ? '__tsh_enc' AND context ->> 'k' IS DISTINCT FROM $1");
    });

    it('binds the active key id and the batch size as ordered parameters', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([]);

      await sut.claimPendingReEncryptionIds(manager, 'key-2', 10);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('ORDER BY id');
      expect(sql).toContain('LIMIT $2');
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(params).toEqual(['key-2', 10]);
    });

    it('returns the claimed ids', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([{ id: 'onboarding-1' }, { id: 'onboarding-2' }]);

      const ids = await sut.claimPendingReEncryptionIds(manager, 'key-2', 10);

      expect(ids).toEqual(['onboarding-1', 'onboarding-2']);
    });

    it('returns an empty array when nothing is pending', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([]);

      const ids = await sut.claimPendingReEncryptionIds(manager, 'key-2', 10);

      expect(ids).toEqual([]);
    });
  });
});
