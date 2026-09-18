import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import { AuditService } from '../audit/audit.service';
import { AppConfig } from '../config/app.config';
import { EncryptionAdminService } from './encryption-admin.service';
import { EncryptionKeyRingService } from './encryption-key-ring.service';
import { EncryptionKeysRepository } from './encryption-keys.repository';
import { EncryptionKeyEntity } from './entity/encryption-key.entity';
import { EncryptionDisabledException } from './errors/encryption-disabled.exception';
import { EncryptionKeyRotationConflictException } from './errors/encryption-key-rotation-conflict.exception';

const manager = {} as EntityManager;

function fakeRow(overrides: Partial<EncryptionKeyEntity> = {}): EncryptionKeyEntity {
  return Object.assign(new EncryptionKeyEntity(), {
    id: 'key-1',
    wrappedKey: 'wrapped-material',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    createdBy: null,
    activatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  });
}

function createHarness(enabled = true, refreshIntervalMs = 15000) {
  const repository = {
    insert: jest.fn().mockResolvedValue(undefined),
    findActive: jest.fn().mockResolvedValue(null),
    findById: jest.fn(),
    findAll: jest.fn().mockResolvedValue([]),
    softDeleteActive: jest.fn().mockResolvedValue(undefined),
    countReEncryptionStatus: jest.fn().mockResolvedValue({ pending: 0, total: 0 }),
  } as unknown as jest.Mocked<EncryptionKeysRepository>;

  const dataSource = {
    manager,
    transaction: jest.fn(
      async (runInTransaction: (entityManager: EntityManager) => Promise<unknown>) =>
        runInTransaction(manager),
    ),
  } as unknown as jest.Mocked<DataSource>;

  const ring = {
    generateWrappedKey: jest.fn().mockReturnValue({ id: 'key-new', wrappedKey: 'wrapped-new' }),
    reload: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<EncryptionKeyRingService>;

  const auditService = {
    logEncryption: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Pick<AuditService, 'logEncryption'>>;

  const configService = {
    get: jest.fn().mockImplementation((key: keyof AppConfig) => {
      if (key === 'ENCRYPTION_ENABLED') {
        return enabled;
      }

      if (key === 'ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS') {
        return refreshIntervalMs;
      }

      throw new Error(`Unexpected config key: ${String(key)}`);
    }),
  } as unknown as ConfigService<AppConfig, true>;

  const service = new EncryptionAdminService(
    repository,
    ring,
    auditService as unknown as AuditService,
    dataSource,
    configService,
  );

  return { service, repository, dataSource, ring, auditService, configService };
}

describe('EncryptionAdminService', () => {
  describe('listKeys', () => {
    it('reports no keys and no progress when encryption is disabled', async () => {
      const { service, repository } = createHarness(false);

      const view = await service.listKeys();

      expect(view).toEqual({ keys: [], reEncryption: { pending: 0, total: 0 } });
      expect(repository.findAll).not.toHaveBeenCalled();
    });

    it('marks the row with a null deletedAt as active and reports every other as inactive', async () => {
      const { service, repository } = createHarness();
      repository.findAll.mockResolvedValue([
        fakeRow({ id: 'key-2', deletedAt: null }),
        fakeRow({ id: 'key-1', deletedAt: new Date('2026-01-02T00:00:00.000Z') }),
      ]);

      const view = await service.listKeys();

      expect(view.keys).toEqual([
        expect.objectContaining({ id: 'key-2', active: true }),
        expect.objectContaining({ id: 'key-1', active: false }),
      ]);
    });

    it('derives reEncryption from the active key id, computed from the loaded rows', async () => {
      const { service, repository } = createHarness();
      repository.findAll.mockResolvedValue([fakeRow({ id: 'key-2', deletedAt: null })]);
      repository.countReEncryptionStatus.mockResolvedValue({ pending: 3, total: 10 });

      const view = await service.listKeys();

      expect(repository.countReEncryptionStatus).toHaveBeenCalledWith(manager, 'key-2');
      expect(view.reEncryption).toEqual({ pending: 3, total: 10 });
    });

    it('never exposes wrappedKey on any reported key', async () => {
      const { service, repository } = createHarness();
      repository.findAll.mockResolvedValue([fakeRow()]);

      const view = await service.listKeys();

      expect(JSON.stringify(view)).not.toContain('wrapped-material');
    });
  });

  describe('addKey', () => {
    it('refuses with a named 4xx when encryption is disabled, touching neither ring nor repository', async () => {
      const { service, repository, ring } = createHarness(false);

      await expect(service.addKey('operator-oid')).rejects.toBeInstanceOf(
        EncryptionDisabledException,
      );
      expect(ring.generateWrappedKey).not.toHaveBeenCalled();
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('soft-deletes the previous active key and inserts the new one inside one transaction', async () => {
      const { service, repository, dataSource } = createHarness();
      repository.findActive.mockResolvedValue(fakeRow({ id: 'key-old' }));

      await service.addKey('operator-oid');

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(repository.softDeleteActive).toHaveBeenCalledWith(manager, expect.any(Date));
      expect(repository.insert).toHaveBeenCalledWith(manager, {
        id: 'key-new',
        wrappedKey: 'wrapped-new',
        createdBy: 'operator-oid',
        activatedAt: expect.any(Date),
      });
      expect(repository.softDeleteActive.mock.invocationCallOrder[0]).toBeLessThan(
        repository.insert.mock.invocationCallOrder[0],
      );
    });

    it("gives the outgoing key a deletedAt equal to the incoming key's activatedAt", async () => {
      const { service, repository } = createHarness(true, 20000);
      const before = Date.now();

      await service.addKey('operator-oid');

      const [, deletedAt] = repository.softDeleteActive.mock.calls[0];
      const [, inserted] = repository.insert.mock.calls[0];

      expect(deletedAt.getTime()).toEqual(inserted.activatedAt.getTime());
      expect(deletedAt.getTime()).toBeGreaterThanOrEqual(before + 20000);
    });

    it('maps a unique-violation on uq_encryption_keys_active to a named 409, not a 500', async () => {
      const { service, repository, dataSource, ring, auditService } = createHarness();
      const conflict = Object.assign(new Error('duplicate key value violates unique constraint'), {
        driverError: { code: '23505', constraint: 'uq_encryption_keys_active' },
      });
      repository.insert.mockRejectedValueOnce(conflict);

      await expect(service.addKey('operator-oid')).rejects.toBeInstanceOf(
        EncryptionKeyRotationConflictException,
      );
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(ring.reload).not.toHaveBeenCalled();
      expect(auditService.logEncryption).not.toHaveBeenCalled();
    });

    it('does not mistake an unrelated constraint violation for the rotation race', async () => {
      const { service, repository } = createHarness();
      const unrelated = Object.assign(new Error('duplicate key value violates unique constraint'), {
        driverError: { code: '23505', constraint: 'some_other_constraint' },
      });
      repository.insert.mockRejectedValueOnce(unrelated);

      await expect(service.addKey('operator-oid')).rejects.toThrow(
        'duplicate key value violates unique constraint',
      );
    });

    it('reloads the ring only after the transaction has committed', async () => {
      const { service, dataSource, ring } = createHarness();

      await service.addKey('operator-oid');

      expect(ring.reload).toHaveBeenCalledTimes(1);
      expect((dataSource.transaction as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        (ring.reload as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it('audits only key_added when there was no previous active key', async () => {
      const { service, auditService } = createHarness();

      await service.addKey('operator-oid');

      expect(auditService.logEncryption).toHaveBeenCalledTimes(1);
      expect(auditService.logEncryption).toHaveBeenCalledWith(expect.anything(), {
        action: 'encryption.key_added',
        actorType: 'operator',
        actorId: 'operator-oid',
        resourceId: 'key-new',
        metadata: { keyId: 'key-new' },
      });
    });

    it('audits key_added and key_superseded, naming both keys, when a previous key existed', async () => {
      const { service, repository, auditService } = createHarness();
      repository.findActive.mockResolvedValue(fakeRow({ id: 'key-old' }));

      await service.addKey('operator-oid');

      expect(auditService.logEncryption).toHaveBeenCalledTimes(2);
      expect(auditService.logEncryption).toHaveBeenNthCalledWith(1, expect.anything(), {
        action: 'encryption.key_added',
        actorType: 'operator',
        actorId: 'operator-oid',
        resourceId: 'key-new',
        metadata: { keyId: 'key-new' },
      });
      expect(auditService.logEncryption).toHaveBeenNthCalledWith(2, expect.anything(), {
        action: 'encryption.key_superseded',
        actorType: 'operator',
        actorId: 'operator-oid',
        resourceId: 'key-old',
        metadata: { keyId: 'key-new', supersededKeyId: 'key-old' },
      });
    });

    it('falls back to the unknown-actor constant for an empty actor id', async () => {
      const { service, repository } = createHarness();

      await service.addKey('');

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ createdBy: ADMIN_ACCESS_UNKNOWN_ACTOR }),
      );
    });

    it('returns only the id of the new key, never its material', async () => {
      const { service } = createHarness();

      const result = await service.addKey('operator-oid');

      expect(result).toEqual({ id: 'key-new' });
    });

    it('leaves exactly one active key when the write fails mid-transaction: neither ring reload nor audit rows follow', async () => {
      const { service, repository, dataSource, ring, auditService } = createHarness();
      repository.insert.mockRejectedValueOnce(new Error('constraint violation'));

      await expect(service.addKey('operator-oid')).rejects.toThrow('constraint violation');

      // Both writes ran inside the one `dataSource.transaction` call, so a real database rolls
      // the soft-delete back along with the failed insert — this never leaves the table with a
      // moment of zero or two active rows. Nothing downstream of the transaction runs either.
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(ring.reload).not.toHaveBeenCalled();
      expect(auditService.logEncryption).not.toHaveBeenCalled();
    });
  });
});
