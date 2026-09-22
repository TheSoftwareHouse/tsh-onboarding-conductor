import { EntityManager, IsNull, Repository } from 'typeorm';
import { EncryptionKeysRepository, isActiveKeyConflict } from './encryption-keys.repository';
import { EncryptionKeyEntity } from './entity/encryption-key.entity';

// What `EncryptionSweepService.resolveTarget` actually produces while encryption is on:
// no source key, because rotation is lazy and only plaintext rows are swept.
const ENCRYPT_TARGET = { activeKeyId: 'key-2', sourceKeyIds: [] };
const DECRYPT_TARGET = { activeKeyId: null, sourceKeyIds: ['key-1', 'key-2'] };
const EXCLUDED = ['0192aaaa-0000-7000-8000-00000000000a'];

describe('EncryptionKeysRepository', () => {
  const createHarness = () => {
    // `updateRotationInterval` goes through the query builder rather than `update`, because it
    // needs `RETURNING id` — the id the write actually landed on. Every other write here still
    // uses `update`.
    const updateQueryBuilderMock = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: [{ id: 'key-1' }] }),
    };
    const entityRepositoryMock = {
      insert: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue(updateQueryBuilderMock),
    } as unknown as Repository<EncryptionKeyEntity>;
    const query = jest.fn().mockResolvedValue([{ total: '0', pending: '0' }]);
    const manager = {
      getRepository: jest.fn().mockReturnValue(entityRepositoryMock),
      query,
    } as unknown as EntityManager;

    return {
      sut: new EncryptionKeysRepository(),
      manager,
      entityRepositoryMock,
      updateQueryBuilderMock,
      query,
    };
  };

  it('inserts a newly wrapped key', async () => {
    const { sut, manager, entityRepositoryMock } = createHarness();
    const activatedAt = new Date('2026-01-01T00:00:00.000Z');

    await sut.insert(manager, {
      id: 'key-1',
      wrappedKey: 'wrapped-material',
      createdBy: 'operator@tsh.io',
      activatedAt,
      rotationInterval: '1w',
    });

    expect(manager.getRepository).toHaveBeenCalledWith(EncryptionKeyEntity);
    expect(entityRepositoryMock.insert).toHaveBeenCalledWith({
      id: 'key-1',
      wrappedKey: 'wrapped-material',
      createdBy: 'operator@tsh.io',
      activatedAt,
      rotationInterval: '1w',
    });
  });

  describe('updateRotationInterval', () => {
    it('writes the schedule onto whichever row is currently active', async () => {
      const { sut, manager, updateQueryBuilderMock } = createHarness();

      await expect(sut.updateRotationInterval(manager, '48h')).resolves.toBe('key-1');

      expect(updateQueryBuilderMock.set).toHaveBeenCalledWith({ rotationInterval: '48h' });
      expect(updateQueryBuilderMock.where).toHaveBeenCalledWith({ deletedAt: IsNull() });
    });

    it('clears the schedule with null, leaving the key itself untouched', async () => {
      const { sut, manager, updateQueryBuilderMock } = createHarness();

      await sut.updateRotationInterval(manager, null);

      expect(updateQueryBuilderMock.set).toHaveBeenCalledWith({ rotationInterval: null });
      expect(updateQueryBuilderMock.where).toHaveBeenCalledWith({ deletedAt: IsNull() });
    });

    /**
     * The whole reason this goes through `RETURNING` rather than a row the caller read first: a
     * rotation committing in between moves `deleted_at IS NULL` onto the incoming key, and the
     * schedule lands there. The id that comes back has to be that key, so the audit row names the
     * key actually carrying the schedule rather than the one the caller happened to read.
     */
    it('reports the row the UPDATE landed on, not one a caller read beforehand', async () => {
      const { sut, manager, updateQueryBuilderMock } = createHarness();
      updateQueryBuilderMock.execute.mockResolvedValue({ raw: [{ id: 'key-2' }] });

      await expect(sut.updateRotationInterval(manager, '48h')).resolves.toBe('key-2');
    });

    it('asks for the id back, so the caller never has to guess which row it wrote', async () => {
      const { sut, manager, updateQueryBuilderMock } = createHarness();

      await sut.updateRotationInterval(manager, '1w');

      expect(updateQueryBuilderMock.returning).toHaveBeenCalledWith(['id']);
    });

    it('reports no row when encryption is off, rather than assuming one was written', async () => {
      const { sut, manager, updateQueryBuilderMock } = createHarness();
      updateQueryBuilderMock.execute.mockResolvedValue({ raw: [] });

      await expect(sut.updateRotationInterval(manager, '1w')).resolves.toBeNull();
    });
  });

  describe('lockKeyRotation', () => {
    it('takes one transaction-scoped advisory lock, keyed so every replica takes the same one', async () => {
      const { sut, manager, query } = createHarness();

      await sut.lockKeyRotation(manager);

      expect(query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'encryption.scheduled_rotation',
      ]);
    });
  });

  it('reads back the single row with a null deletedAt', async () => {
    const { sut, manager, entityRepositoryMock } = createHarness();

    await sut.findActive(manager);

    expect(entityRepositoryMock.findOne).toHaveBeenCalledWith({ where: { deletedAt: IsNull() } });
  });

  it('returns null when no key is active', async () => {
    const { sut, manager } = createHarness();

    await expect(sut.findActive(manager)).resolves.toBeNull();
  });

  it('reads back every key, most recent first', async () => {
    const { sut, manager, entityRepositoryMock } = createHarness();

    await sut.findAll(manager);

    expect(entityRepositoryMock.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } });
  });

  describe('softDeleteActive', () => {
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

    it('reports how many rows it marked, and zero when nothing was active', async () => {
      const { sut, manager, entityRepositoryMock } = createHarness();

      await expect(sut.softDeleteActive(manager, new Date())).resolves.toBe(1);

      (entityRepositoryMock.update as jest.Mock).mockResolvedValueOnce({ affected: 0 });
      await expect(sut.softDeleteActive(manager, new Date())).resolves.toBe(0);

      (entityRepositoryMock.update as jest.Mock).mockResolvedValueOnce({});
      await expect(sut.softDeleteActive(manager, new Date())).resolves.toBe(0);
    });

    it('never touches wrappedKey', async () => {
      const { sut, manager, entityRepositoryMock } = createHarness();

      await sut.softDeleteActive(manager, new Date());

      const [, patch] = (entityRepositoryMock.update as jest.Mock).mock.calls[0];
      expect(patch).not.toHaveProperty('wrappedKey');
    });
  });

  describe('lockSweepAudit', () => {
    it('takes a transaction-scoped advisory lock keyed on the action and the resource id together', async () => {
      const { sut, manager, query } = createHarness();

      await sut.lockSweepAudit(manager, 'encryption.reencryption_started', 'key-1');

      expect(query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'encryption.reencryption_started:key-1',
      ]);
    });

    it('locks a different key for started and completed on the same resource, so they cannot block each other', async () => {
      const { sut, manager, query } = createHarness();

      await sut.lockSweepAudit(manager, 'encryption.reencryption_started', 'key-1');
      await sut.lockSweepAudit(manager, 'encryption.reencryption_completed', 'key-1');

      const [[, firstParams], [, secondParams]] = query.mock.calls as [string, string[]][][];
      expect(firstParams).not.toEqual(secondParams);
    });
  });

  describe('hasPendingSweep', () => {
    it('probes plaintext rows alone, as one indexed EXISTS, while encryption is on', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([{ exists: false }]);

      await sut.hasPendingSweep(manager, ENCRYPT_TARGET, EXCLUDED);

      const [sql, params] = query.mock.calls[0];
      // Never a disjunction with the enveloped half: the planner answers `EXISTS` over `OR` with
      // a sequential scan, and with lazy rotation that half can never match anything anyway.
      expect(sql.match(/EXISTS \(/g)).toHaveLength(1);
      expect(sql).toContain("NOT (context ? '__tsh_enc')");
      expect(sql).not.toContain("context ->> 'k'");
      expect(sql).toContain('NOT (id = ANY($1::uuid[]))');
      expect(params).toEqual([EXCLUDED]);
    });

    it('probes only enveloped rows on source keys while encryption is off', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([{ exists: true }]);

      await expect(sut.hasPendingSweep(manager, DECRYPT_TARGET, [])).resolves.toBe(true);

      const [sql, params] = query.mock.calls[0];
      expect(sql.match(/EXISTS \(/g)).toHaveLength(1);
      expect(sql).not.toContain("NOT (context ? '__tsh_enc')");
      expect(params).toEqual([['key-1', 'key-2'], []]);
    });

    it('never uses an inequality on the key id, which a btree cannot serve', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([{ exists: false }]);

      await sut.hasPendingSweep(manager, ENCRYPT_TARGET, []);

      const [sql] = query.mock.calls[0];
      expect(sql).not.toContain('IS DISTINCT FROM');
      expect(sql).not.toContain('<>');
    });

    it('reports false when the query returns no row', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([]);

      await expect(sut.hasPendingSweep(manager, ENCRYPT_TARGET, [])).resolves.toBe(false);
    });
  });

  describe('countSweepStatus', () => {
    it('counts only plaintext rows as pending while encryption is on, so a row on a superseded key never holds the count above zero', async () => {
      const { sut, manager, query } = createHarness();

      await sut.countSweepStatus(manager, true);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('count(*) AS total');
      expect(sql).toContain("count(*) FILTER (WHERE NOT (context ? '__tsh_enc')) AS pending");
      expect(sql).not.toContain('IS DISTINCT FROM');
      expect(params).toBeUndefined();
    });

    it('counts every enveloped row as pending while encryption is off', async () => {
      const { sut, manager, query } = createHarness();

      await sut.countSweepStatus(manager, false);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("count(*) FILTER (WHERE context ? '__tsh_enc') AS pending");
      expect(sql).not.toContain('IS DISTINCT FROM');
      expect(params).toBeUndefined();
    });

    it('coerces the counted rows to numbers', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([{ total: '7', pending: '3' }]);

      await expect(sut.countSweepStatus(manager, true)).resolves.toEqual({
        pending: 3,
        total: 7,
      });
    });

    it('reports zero for both when the query returns no row', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([]);

      await expect(sut.countSweepStatus(manager, true)).resolves.toEqual({
        pending: 0,
        total: 0,
      });
    });
  });

  describe('claimPendingSweepIds', () => {
    it('claims plaintext rows alone while encryption is on, skipping locked and excluded rows', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([]);

      await sut.claimPendingSweepIds(manager, ENCRYPT_TARGET, 10, EXCLUDED);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("NOT (context ? '__tsh_enc')");
      expect(sql).not.toContain("context ->> 'k'");
      expect(sql).toContain('NOT (id = ANY($1::uuid[]))');
      expect(sql).toContain('LIMIT $2');
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(sql).not.toContain('ORDER BY');
      expect(params).toEqual([EXCLUDED, 10]);
    });

    it('claims only enveloped rows on source keys while encryption is off', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([]);

      await sut.claimPendingSweepIds(manager, DECRYPT_TARGET, 10, []);

      const [sql, params] = query.mock.calls[0];
      expect(sql).not.toContain("NOT (context ? '__tsh_enc')");
      expect(sql).toContain("context ? '__tsh_enc' AND context ->> 'k' = ANY($1::text[])");
      expect(params).toEqual([['key-1', 'key-2'], [], 10]);
    });

    it('shares its row predicates with hasPendingSweep, so the probe can never see work the claim would not', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([{ exists: false }]);

      await sut.hasPendingSweep(manager, ENCRYPT_TARGET, []);
      const [encryptProbeSql] = query.mock.calls[0];
      query.mockClear();
      query.mockResolvedValue([]);
      await sut.claimPendingSweepIds(manager, ENCRYPT_TARGET, 10, []);
      const [encryptClaimSql] = query.mock.calls[0];

      for (const fragment of ["NOT (context ? '__tsh_enc')", 'NOT (id = ANY($1::uuid[]))']) {
        expect(encryptProbeSql).toContain(fragment);
        expect(encryptClaimSql).toContain(fragment);
      }

      query.mockClear();
      query.mockResolvedValue([{ exists: false }]);
      await sut.hasPendingSweep(manager, DECRYPT_TARGET, []);
      const [decryptProbeSql] = query.mock.calls[0];
      query.mockClear();
      query.mockResolvedValue([]);
      await sut.claimPendingSweepIds(manager, DECRYPT_TARGET, 10, []);
      const [decryptClaimSql] = query.mock.calls[0];

      for (const fragment of [
        "context ? '__tsh_enc' AND context ->> 'k' = ANY($1::text[])",
        'NOT (id = ANY($2::uuid[]))',
      ]) {
        expect(decryptProbeSql).toContain(fragment);
        expect(decryptClaimSql).toContain(fragment);
      }
    });

    it('returns the claimed ids', async () => {
      const { sut, manager, query } = createHarness();
      query.mockResolvedValue([{ id: 'onboarding-1' }, { id: 'onboarding-2' }]);

      await expect(sut.claimPendingSweepIds(manager, ENCRYPT_TARGET, 10, [])).resolves.toEqual([
        'onboarding-1',
        'onboarding-2',
      ]);
    });
  });
});

describe('isActiveKeyConflict', () => {
  it('matches a unique violation on uq_encryption_keys_active', () => {
    const conflict = Object.assign(new Error('duplicate key value violates unique constraint'), {
      driverError: { code: '23505', constraint: 'uq_encryption_keys_active' },
    });

    expect(isActiveKeyConflict(conflict)).toBe(true);
  });

  it('does not match a unique violation on another constraint', () => {
    expect(isActiveKeyConflict({ code: '23505', constraint: 'some_other_constraint' })).toBe(false);
  });
});
