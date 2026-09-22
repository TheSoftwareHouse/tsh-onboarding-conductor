import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import { AuditService } from '../audit/audit.service';
import { AppConfig } from '../config/app.config';
import { EncryptionAdminService } from './encryption-admin.service';
import { EncryptionKeyRingService } from './encryption-key-ring.service';
import { EncryptionKeysRepository } from './encryption-keys.repository';
import { EncryptionKeyEntity } from './entity/encryption-key.entity';
import { DEFAULT_ENCRYPTION_KEY_ROTATION_INTERVAL } from './encryption-key-rotation';
import { EncryptionDisabledException } from './errors/encryption-disabled.exception';
import { EncryptionKeyNotConfiguredException } from './errors/encryption-key-not-configured.exception';
import { EncryptionKeyRingConflictException } from './errors/encryption-key-ring-conflict.exception';

const manager = {} as EntityManager;
const REFRESH_INTERVAL_MS = 15000;
const MILLISECONDS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;

/** A `createdAt` that far back, for a key whose schedule has — or has not — come due. */
const daysAgo = (days: number): Date =>
  new Date(Date.now() - days * HOURS_PER_DAY * MILLISECONDS_PER_HOUR);

const activeKeyConflict = () =>
  Object.assign(new Error('duplicate key value violates unique constraint'), {
    driverError: { code: '23505', constraint: 'uq_encryption_keys_active' },
  });

function fakeRow(overrides: Partial<EncryptionKeyEntity> = {}): EncryptionKeyEntity {
  return Object.assign(new EncryptionKeyEntity(), {
    id: 'key-1',
    wrappedKey: 'wrapped-material',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    createdBy: null,
    activatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    rotationInterval: null,
    ...overrides,
  });
}

function createHarness(options: { keyConfigured?: boolean; rows?: EncryptionKeyEntity[] } = {}) {
  const rows = options.rows ?? [];
  const repository = {
    insert: jest.fn().mockResolvedValue(undefined),
    findActive: jest.fn().mockResolvedValue(rows.find((row) => row.deletedAt === null) ?? null),
    findAll: jest.fn().mockResolvedValue(rows),
    softDeleteActive: jest
      .fn()
      .mockResolvedValue(rows.some((row) => row.deletedAt === null) ? 1 : 0),
    countSweepStatus: jest.fn().mockResolvedValue({ pending: 0, total: 0 }),
    // Answers with the id of the row the `UPDATE` landed on, or `null` when there was none — the
    // real repository's `RETURNING id`, which by default is whichever row is unretired here.
    updateRotationInterval: jest
      .fn()
      .mockResolvedValue(rows.find((row) => row.deletedAt === null)?.id ?? null),
    lockKeyRotation: jest.fn().mockResolvedValue(undefined),
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
    isKeyEncryptionKeyConfigured: jest.fn().mockReturnValue(options.keyConfigured ?? true),
  } as unknown as jest.Mocked<EncryptionKeyRingService>;

  const auditService = {
    logEncryption: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Pick<AuditService, 'logEncryption'>>;

  const configService = {
    getOrThrow: jest.fn().mockImplementation((key: keyof AppConfig) => {
      if (key === 'ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS') {
        return REFRESH_INTERVAL_MS;
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
  describe('getState', () => {
    it('reports encryption off with the key history intact when no row is unretired', async () => {
      const { service, repository } = createHarness({
        rows: [fakeRow({ id: 'key-1', deletedAt: new Date('2026-01-02T00:00:00.000Z') })],
      });

      const view = await service.getState();

      expect(view.enabled).toBe(false);
      expect(view.keys).toEqual([expect.objectContaining({ id: 'key-1', active: false })]);
      expect(repository.countSweepStatus).toHaveBeenCalledWith(manager, null);
    });

    it('reports encryption on, with progress counted against the unretired key', async () => {
      const { service, repository } = createHarness({
        rows: [
          fakeRow({ id: 'key-2', deletedAt: null }),
          fakeRow({ id: 'key-1', deletedAt: new Date('2026-01-02T00:00:00.000Z') }),
        ],
      });
      repository.countSweepStatus.mockResolvedValue({ pending: 3, total: 10 });

      const view = await service.getState();

      expect(view.enabled).toBe(true);
      expect(view.keys).toEqual([
        expect.objectContaining({ id: 'key-2', active: true, pendingActivation: false }),
        expect.objectContaining({ id: 'key-1', active: false, pendingActivation: false }),
      ]);
      expect(repository.countSweepStatus).toHaveBeenCalledWith(manager, 'key-2');
      expect(view.progress).toEqual({ pending: 3, total: 10 });
    });

    it('reports on-but-pending during the grace window: enabled, no key active, the new key pending activation', async () => {
      const inFifteenSeconds = new Date(Date.now() + REFRESH_INTERVAL_MS);
      const { service } = createHarness({
        rows: [fakeRow({ id: 'key-1', activatedAt: inFifteenSeconds, deletedAt: null })],
      });

      const view = await service.getState();

      expect(view.enabled).toBe(true);
      expect(view.keys).toEqual([
        expect.objectContaining({ id: 'key-1', active: false, pendingActivation: true }),
      ]);
    });

    it('reports off-but-active during the grace window after turning encryption off', async () => {
      const inFifteenSeconds = new Date(Date.now() + REFRESH_INTERVAL_MS);
      const { service, repository } = createHarness({
        rows: [fakeRow({ id: 'key-1', deletedAt: inFifteenSeconds })],
      });

      const view = await service.getState();

      expect(view.enabled).toBe(false);
      expect(view.keys).toEqual([
        expect.objectContaining({ id: 'key-1', active: true, pendingActivation: false }),
      ]);
      expect(repository.countSweepStatus).toHaveBeenCalledWith(manager, null);
    });

    it('reports whether this process holds the key-encryption key', async () => {
      await expect(
        createHarness({ keyConfigured: false }).service.getState(),
      ).resolves.toMatchObject({ keyConfigured: false });
      await expect(createHarness().service.getState()).resolves.toMatchObject({
        keyConfigured: true,
      });
    });

    it("reports the active key's schedule and when it next falls due", async () => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      const { service } = createHarness({
        rows: [fakeRow({ id: 'key-1', deletedAt: null, createdAt, rotationInterval: '1w' })],
      });

      const view = await service.getState();

      expect(view.rotation).toEqual({
        interval: '1w',
        nextRotationAt: new Date('2026-01-08T00:00:00.000Z'),
      });
    });

    it('reports no schedule while automatic rotation is off, and none at all while encryption is', async () => {
      const withKey = createHarness({ rows: [fakeRow({ deletedAt: null })] });
      const withoutKey = createHarness({
        rows: [
          fakeRow({ deletedAt: new Date('2026-01-02T00:00:00.000Z'), rotationInterval: '1w' }),
        ],
      });

      await expect(withKey.service.getState()).resolves.toMatchObject({
        rotation: { interval: null, nextRotationAt: null },
      });
      await expect(withoutKey.service.getState()).resolves.toMatchObject({
        rotation: { interval: null, nextRotationAt: null },
      });
    });

    it('never exposes wrappedKey on any reported key', async () => {
      const { service } = createHarness({ rows: [fakeRow()] });

      const view = await service.getState();

      expect(JSON.stringify(view)).not.toContain('wrapped-material');
    });
  });

  describe('setEnabled(true)', () => {
    it('refuses with a named 503 when no key-encryption key is configured, touching nothing', async () => {
      const { service, repository, ring } = createHarness({ keyConfigured: false });

      await expect(service.setEnabled(true, 'operator-oid')).rejects.toBeInstanceOf(
        EncryptionKeyNotConfiguredException,
      );
      expect(ring.generateWrappedKey).not.toHaveBeenCalled();
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('inserts a first key one refresh interval ahead of now, reloads the ring, and audits it', async () => {
      const { service, repository, ring, auditService } = createHarness();
      const before = Date.now();

      await service.setEnabled(true, 'operator-oid');

      expect(repository.insert).toHaveBeenCalledWith(manager, {
        id: 'key-new',
        wrappedKey: 'wrapped-new',
        createdBy: 'operator-oid',
        activatedAt: expect.any(Date),
        rotationInterval: DEFAULT_ENCRYPTION_KEY_ROTATION_INTERVAL,
      });
      const [, inserted] = repository.insert.mock.calls[0];
      expect(inserted.activatedAt.getTime()).toBeGreaterThanOrEqual(before + REFRESH_INTERVAL_MS);
      expect(repository.softDeleteActive).not.toHaveBeenCalled();
      expect(ring.reload).toHaveBeenCalledTimes(1);
      expect(auditService.logEncryption).toHaveBeenCalledTimes(1);
      expect(auditService.logEncryption).toHaveBeenCalledWith(expect.anything(), {
        action: 'encryption.enabled',
        actorType: 'operator',
        actorId: 'operator-oid',
        resourceId: 'key-new',
        metadata: { keyId: 'key-new' },
      });
    });

    it('is idempotent: changes and audits nothing when an unretired key already exists', async () => {
      const { service, repository, ring, auditService } = createHarness({
        rows: [fakeRow({ id: 'key-1', deletedAt: null })],
      });

      const view = await service.setEnabled(true, 'operator-oid');

      expect(repository.insert).not.toHaveBeenCalled();
      expect(ring.reload).not.toHaveBeenCalled();
      expect(auditService.logEncryption).not.toHaveBeenCalled();
      expect(view.enabled).toBe(true);
    });

    it('treats the loser of two operators turning encryption on at the same instant as "already on": no error, no reload, no audit', async () => {
      const { service, repository, ring, auditService } = createHarness();
      repository.insert.mockRejectedValueOnce(activeKeyConflict());
      repository.findAll.mockResolvedValue([fakeRow({ id: 'key-winner', deletedAt: null })]);

      const view = await service.setEnabled(true, 'operator-oid');

      expect(view.enabled).toBe(true);
      expect(ring.reload).not.toHaveBeenCalled();
      expect(auditService.logEncryption).not.toHaveBeenCalled();
    });

    it('still audits the change when the local ring reload fails, since the change is already durable', async () => {
      const { service, ring, auditService } = createHarness();
      ring.reload.mockRejectedValueOnce(new Error('connection reset'));

      const view = await service.setEnabled(true, 'operator-oid');

      expect(view).toBeDefined();
      expect(auditService.logEncryption).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'encryption.enabled' }),
      );
    });

    it('surfaces an unrelated insert failure rather than swallowing it', async () => {
      const { service, repository } = createHarness();
      repository.insert.mockRejectedValueOnce(new Error('connection reset'));

      await expect(service.setEnabled(true, 'operator-oid')).rejects.toThrow('connection reset');
    });

    it('falls back to the unknown-actor constant for an empty actor id', async () => {
      const { service, repository, auditService } = createHarness();

      await service.setEnabled(true, '');

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ createdBy: ADMIN_ACCESS_UNKNOWN_ACTOR }),
      );
      expect(auditService.logEncryption).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actorId: ADMIN_ACCESS_UNKNOWN_ACTOR }),
      );
    });

    it('returns the resulting state', async () => {
      const { service, repository } = createHarness();
      repository.findAll.mockResolvedValue([fakeRow({ id: 'key-new', deletedAt: null })]);

      const view = await service.setEnabled(true, 'operator-oid');

      expect(view.enabled).toBe(true);
      expect(view.keys).toEqual([expect.objectContaining({ id: 'key-new' })]);
    });
  });

  describe('setEnabled(false)', () => {
    it('retires the active key one refresh interval ahead of now, reloads the ring, and audits it', async () => {
      const { service, repository, ring, auditService } = createHarness({
        rows: [fakeRow({ id: 'key-1', deletedAt: null })],
      });
      const before = Date.now();

      await service.setEnabled(false, 'operator-oid');

      expect(repository.softDeleteActive).toHaveBeenCalledWith(manager, expect.any(Date));
      const [, deletedAt] = repository.softDeleteActive.mock.calls[0];
      expect(deletedAt.getTime()).toBeGreaterThanOrEqual(before + REFRESH_INTERVAL_MS);
      expect(repository.insert).not.toHaveBeenCalled();
      expect(ring.reload).toHaveBeenCalledTimes(1);
      expect(auditService.logEncryption).toHaveBeenCalledWith(expect.anything(), {
        action: 'encryption.disabled',
        actorType: 'operator',
        actorId: 'operator-oid',
        resourceId: 'key-1',
        metadata: { keyId: 'key-1' },
      });
    });

    it('is idempotent: changes and audits nothing when encryption is already off', async () => {
      const { service, repository, ring, auditService } = createHarness({
        rows: [fakeRow({ id: 'key-1', deletedAt: new Date('2026-01-02T00:00:00.000Z') })],
      });

      const view = await service.setEnabled(false, 'operator-oid');

      expect(repository.softDeleteActive).not.toHaveBeenCalled();
      expect(ring.reload).not.toHaveBeenCalled();
      expect(auditService.logEncryption).not.toHaveBeenCalled();
      expect(view.enabled).toBe(false);
    });

    it('audits nothing when a concurrent request retired the key between its read and its write', async () => {
      const { service, repository, ring, auditService } = createHarness({
        rows: [fakeRow({ id: 'key-1', deletedAt: null })],
      });
      repository.softDeleteActive.mockResolvedValue(0);

      await service.setEnabled(false, 'operator-oid');

      expect(ring.reload).not.toHaveBeenCalled();
      expect(auditService.logEncryption).not.toHaveBeenCalled();
    });

    it('does not need the key-encryption key: it only marks a row', async () => {
      const { service, repository } = createHarness({
        keyConfigured: false,
        rows: [fakeRow({ id: 'key-1', deletedAt: null })],
      });

      await service.setEnabled(false, 'operator-oid');

      expect(repository.softDeleteActive).toHaveBeenCalledTimes(1);
    });
  });

  describe('addKey', () => {
    it('refuses with a named 503 when no key-encryption key is configured, touching neither ring nor repository', async () => {
      const { service, repository, ring } = createHarness({
        keyConfigured: false,
        rows: [fakeRow({ id: 'key-old', deletedAt: null })],
      });

      await expect(service.addKey('operator-oid')).rejects.toBeInstanceOf(
        EncryptionKeyNotConfiguredException,
      );
      expect(ring.generateWrappedKey).not.toHaveBeenCalled();
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('refuses with a named 409 when encryption is off, inserting nothing', async () => {
      const { service, repository, ring, auditService } = createHarness();

      await expect(service.addKey('operator-oid')).rejects.toBeInstanceOf(
        EncryptionDisabledException,
      );
      expect(repository.insert).not.toHaveBeenCalled();
      expect(ring.reload).not.toHaveBeenCalled();
      expect(auditService.logEncryption).not.toHaveBeenCalled();
    });

    it('refuses when a concurrent request retired the key between its read and its write', async () => {
      const { service, repository } = createHarness({
        rows: [fakeRow({ id: 'key-old', deletedAt: null })],
      });
      repository.softDeleteActive.mockResolvedValueOnce(0);

      await expect(service.addKey('operator-oid')).rejects.toBeInstanceOf(
        EncryptionDisabledException,
      );
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('soft-deletes the previous active key and inserts the new one inside one transaction', async () => {
      const { service, repository, dataSource } = createHarness({
        rows: [fakeRow({ id: 'key-old', deletedAt: null })],
      });

      await service.addKey('operator-oid');

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(repository.softDeleteActive).toHaveBeenCalledWith(manager, expect.any(Date));
      expect(repository.insert).toHaveBeenCalledWith(manager, {
        id: 'key-new',
        wrappedKey: 'wrapped-new',
        createdBy: 'operator-oid',
        activatedAt: expect.any(Date),
        rotationInterval: null,
      });
      expect(repository.softDeleteActive.mock.invocationCallOrder[0]).toBeLessThan(
        repository.insert.mock.invocationCallOrder[0],
      );
    });

    it("gives the outgoing key a deletedAt equal to the incoming key's activatedAt, one refresh interval ahead", async () => {
      const { service, repository } = createHarness({
        rows: [fakeRow({ id: 'key-old', deletedAt: null })],
      });
      const before = Date.now();

      await service.addKey('operator-oid');

      const [, deletedAt] = repository.softDeleteActive.mock.calls[0];
      const [, inserted] = repository.insert.mock.calls[0];

      expect(deletedAt.getTime()).toEqual(inserted.activatedAt.getTime());
      expect(deletedAt.getTime()).toBeGreaterThanOrEqual(before + REFRESH_INTERVAL_MS);
    });

    it('maps a unique-violation on uq_encryption_keys_active to a named 409, not a 500', async () => {
      const { service, repository, dataSource, ring, auditService } = createHarness({
        rows: [fakeRow({ id: 'key-old', deletedAt: null })],
      });
      repository.insert.mockRejectedValueOnce(activeKeyConflict());

      await expect(service.addKey('operator-oid')).rejects.toBeInstanceOf(
        EncryptionKeyRingConflictException,
      );
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(ring.reload).not.toHaveBeenCalled();
      expect(auditService.logEncryption).not.toHaveBeenCalled();
    });

    it('does not mistake an unrelated constraint violation for the rotation race', async () => {
      const { service, repository } = createHarness({
        rows: [fakeRow({ id: 'key-old', deletedAt: null })],
      });
      repository.insert.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value violates unique constraint'), {
          driverError: { code: '23505', constraint: 'some_other_constraint' },
        }),
      );

      await expect(service.addKey('operator-oid')).rejects.toThrow(
        'duplicate key value violates unique constraint',
      );
    });

    it('reloads the ring only after the transaction has committed', async () => {
      const { service, dataSource, ring } = createHarness({
        rows: [fakeRow({ id: 'key-old', deletedAt: null })],
      });

      await service.addKey('operator-oid');

      expect(ring.reload).toHaveBeenCalledTimes(1);
      expect((dataSource.transaction as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        (ring.reload as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it('audits key_added and key_superseded, naming both keys', async () => {
      const { service, auditService } = createHarness({
        rows: [fakeRow({ id: 'key-old', deletedAt: null })],
      });

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

    /**
     * The rotation is already committed and the ring already holds the new key by the time either
     * audit row is attempted. Answering with a `500` would invite the operator to press Add key
     * again — and unlike turning encryption on or off, that retry is not idempotent: it would
     * rotate a second time, for a second full re-encryption sweep of every onboarding.
     */
    it('still returns the new key when an audit write fails: the rotation is already durable', async () => {
      const { service, auditService } = createHarness({
        rows: [fakeRow({ id: 'key-old', deletedAt: null })],
      });
      auditService.logEncryption.mockRejectedValue(new Error('audit_log unreachable'));

      await expect(service.addKey('operator-oid')).resolves.toEqual({ id: 'key-new' });
    });

    it('attempts both halves of the trail even when the first one fails', async () => {
      const { service, auditService } = createHarness({
        rows: [fakeRow({ id: 'key-old', deletedAt: null })],
      });
      auditService.logEncryption.mockRejectedValueOnce(new Error('audit_log unreachable'));

      await service.addKey('operator-oid');

      expect(auditService.logEncryption).toHaveBeenCalledTimes(2);
      expect(auditService.logEncryption).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({ action: 'encryption.key_superseded' }),
      );
    });

    it('falls back to the unknown-actor constant for an empty actor id', async () => {
      const { service, repository } = createHarness({
        rows: [fakeRow({ id: 'key-old', deletedAt: null })],
      });

      await service.addKey('');

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ createdBy: ADMIN_ACCESS_UNKNOWN_ACTOR }),
      );
    });

    it('returns only the id of the new key, never its material', async () => {
      const { service } = createHarness({ rows: [fakeRow({ id: 'key-old', deletedAt: null })] });

      await expect(service.addKey('operator-oid')).resolves.toEqual({ id: 'key-new' });
    });

    it('leaves the previous key in place when the write fails mid-transaction: neither ring reload nor audit rows follow', async () => {
      const { service, repository, dataSource, ring, auditService } = createHarness({
        rows: [fakeRow({ id: 'key-old', deletedAt: null })],
      });
      repository.insert.mockRejectedValueOnce(new Error('constraint violation'));

      await expect(service.addKey('operator-oid')).rejects.toThrow('constraint violation');

      // Both writes ran inside the one `dataSource.transaction` call, so a real database rolls
      // the soft-delete back along with the failed insert. Nothing downstream runs either.
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(ring.reload).not.toHaveBeenCalled();
      expect(auditService.logEncryption).not.toHaveBeenCalled();
    });

    it('carries the schedule of the key it supersedes onto the new one', async () => {
      const { service, repository } = createHarness({
        rows: [fakeRow({ id: 'key-old', deletedAt: null, rotationInterval: '2w' })],
      });

      await service.addKey('operator-oid');

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ rotationInterval: '2w' }),
      );
    });

    it('does not take the scheduled-rotation lock: an explicit rotation is never a duplicate', async () => {
      const { service, repository } = createHarness({
        rows: [fakeRow({ id: 'key-old', deletedAt: null })],
      });

      await service.addKey('operator-oid');

      expect(repository.lockKeyRotation).not.toHaveBeenCalled();
    });
  });

  describe('setRotationInterval', () => {
    it('writes the chosen interval onto the active key and audits who chose it', async () => {
      const { service, repository, auditService } = createHarness({
        rows: [fakeRow({ id: 'key-1', deletedAt: null, rotationInterval: '1w' })],
      });

      const view = await service.setRotationInterval('48h', 'operator-oid');

      expect(repository.updateRotationInterval).toHaveBeenCalledWith(manager, '48h');
      expect(auditService.logEncryption).toHaveBeenCalledWith(expect.anything(), {
        action: 'encryption.rotation_schedule_changed',
        actorType: 'operator',
        actorId: 'operator-oid',
        resourceId: 'key-1',
        metadata: { keyId: 'key-1', rotationInterval: '48h' },
      });
      expect(view.enabled).toBe(true);
    });

    it('turns automatic rotation off with null, auditing that as the change it is', async () => {
      const { service, repository, auditService } = createHarness({
        rows: [fakeRow({ id: 'key-1', deletedAt: null, rotationInterval: '1w' })],
      });

      await service.setRotationInterval(null, 'operator-oid');

      expect(repository.updateRotationInterval).toHaveBeenCalledWith(manager, null);
      expect(auditService.logEncryption).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ metadata: { keyId: 'key-1', rotationInterval: null } }),
      );
    });

    it('is idempotent: choosing the interval already in force writes and audits nothing', async () => {
      const { service, repository, auditService } = createHarness({
        rows: [fakeRow({ id: 'key-1', deletedAt: null, rotationInterval: '1w' })],
      });

      const view = await service.setRotationInterval('1w', 'operator-oid');

      expect(repository.updateRotationInterval).not.toHaveBeenCalled();
      expect(auditService.logEncryption).not.toHaveBeenCalled();
      expect(view.rotation.interval).toBe('1w');
    });

    it('refuses with a named 409 when encryption is off: there is no key to schedule', async () => {
      const { service, repository, auditService } = createHarness();

      await expect(service.setRotationInterval('1w', 'operator-oid')).rejects.toBeInstanceOf(
        EncryptionDisabledException,
      );
      expect(repository.updateRotationInterval).not.toHaveBeenCalled();
      expect(auditService.logEncryption).not.toHaveBeenCalled();
    });

    it('refuses when a concurrent request turned encryption off between the read and the write', async () => {
      const { service, repository, auditService } = createHarness({
        rows: [fakeRow({ id: 'key-1', deletedAt: null })],
      });
      repository.updateRotationInterval.mockResolvedValueOnce(null);

      await expect(service.setRotationInterval('1w', 'operator-oid')).rejects.toBeInstanceOf(
        EncryptionDisabledException,
      );
      expect(auditService.logEncryption).not.toHaveBeenCalled();
    });

    /**
     * A rotation committing between the read and the write moves `deleted_at IS NULL` onto the
     * incoming key, so the schedule lands there rather than on the row that was read. The trail
     * has to name the key that actually carries it — filing this against the superseded key would
     * attribute a schedule to a key that never had one.
     */
    it('audits the key the write landed on when a rotation moved it mid-request', async () => {
      const { service, repository, auditService } = createHarness({
        rows: [fakeRow({ id: 'key-read', deletedAt: null, rotationInterval: '1w' })],
      });
      repository.updateRotationInterval.mockResolvedValueOnce('key-rotated-in');

      await service.setRotationInterval('48h', 'operator-oid');

      expect(auditService.logEncryption).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          resourceId: 'key-rotated-in',
          metadata: { keyId: 'key-rotated-in', rotationInterval: '48h' },
        }),
      );
    });

    it('falls back to the unknown-actor constant for an empty actor id', async () => {
      const { service, auditService } = createHarness({
        rows: [fakeRow({ id: 'key-1', deletedAt: null })],
      });

      await service.setRotationInterval('1w', '');

      expect(auditService.logEncryption).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actorId: ADMIN_ACCESS_UNKNOWN_ACTOR }),
      );
    });
  });

  describe('rotateIfDue', () => {
    it('rotates a key whose schedule has come due, audited as the engine rather than an operator', async () => {
      const { service, repository, ring, auditService } = createHarness({
        rows: [
          fakeRow({
            id: 'key-old',
            deletedAt: null,
            createdAt: daysAgo(3),
            rotationInterval: '48h',
          }),
        ],
      });

      await expect(service.rotateIfDue()).resolves.toEqual({ id: 'key-new' });

      expect(repository.insert).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ createdBy: 'engine', rotationInterval: '48h' }),
      );
      expect(ring.reload).toHaveBeenCalledTimes(1);
      expect(auditService.logEncryption).toHaveBeenNthCalledWith(1, expect.anything(), {
        action: 'encryption.key_added',
        actorType: 'system',
        actorId: 'engine',
        resourceId: 'key-new',
        metadata: { keyId: 'key-new' },
      });
      expect(auditService.logEncryption).toHaveBeenNthCalledWith(2, expect.anything(), {
        action: 'encryption.key_superseded',
        actorType: 'system',
        actorId: 'engine',
        resourceId: 'key-old',
        metadata: { keyId: 'key-new', supersededKeyId: 'key-old' },
      });
    });

    it('takes the advisory lock before reading the key it may replace', async () => {
      const { service, repository } = createHarness({
        rows: [fakeRow({ deletedAt: null, createdAt: daysAgo(3), rotationInterval: '48h' })],
      });

      await service.rotateIfDue();

      expect(repository.lockKeyRotation).toHaveBeenCalledWith(manager);
      expect(repository.lockKeyRotation.mock.invocationCallOrder[0]).toBeLessThan(
        repository.findActive.mock.invocationCallOrder[0],
      );
    });

    it('does nothing while the schedule has not come due yet', async () => {
      const { service, repository, ring, auditService } = createHarness({
        rows: [fakeRow({ deletedAt: null, createdAt: daysAgo(1), rotationInterval: '48h' })],
      });

      await expect(service.rotateIfDue()).resolves.toBeNull();

      expect(repository.softDeleteActive).not.toHaveBeenCalled();
      expect(repository.insert).not.toHaveBeenCalled();
      expect(ring.reload).not.toHaveBeenCalled();
      expect(auditService.logEncryption).not.toHaveBeenCalled();
    });

    it('does nothing when the active key carries no schedule at all', async () => {
      const { service, repository } = createHarness({
        rows: [fakeRow({ deletedAt: null, createdAt: daysAgo(400), rotationInterval: null })],
      });

      await expect(service.rotateIfDue()).resolves.toBeNull();

      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('does nothing when encryption is off', async () => {
      const { service, repository } = createHarness();

      await expect(service.rotateIfDue()).resolves.toBeNull();

      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('treats losing the race against an operator rotating at the same instant as nothing to do', async () => {
      const { service, repository, ring, auditService } = createHarness({
        rows: [fakeRow({ deletedAt: null, createdAt: daysAgo(3), rotationInterval: '48h' })],
      });
      repository.insert.mockRejectedValueOnce(activeKeyConflict());

      await expect(service.rotateIfDue()).resolves.toBeNull();

      expect(ring.reload).not.toHaveBeenCalled();
      expect(auditService.logEncryption).not.toHaveBeenCalled();
    });

    it('surfaces an unrelated failure rather than reporting nothing to do', async () => {
      const { service, repository } = createHarness({
        rows: [fakeRow({ deletedAt: null, createdAt: daysAgo(3), rotationInterval: '48h' })],
      });
      repository.insert.mockRejectedValueOnce(new Error('connection reset'));

      await expect(service.rotateIfDue()).rejects.toThrow('connection reset');
    });

    it('refuses on a process holding no key-encryption key: it could not wrap a new one', async () => {
      const { service, repository } = createHarness({
        keyConfigured: false,
        rows: [fakeRow({ deletedAt: null, createdAt: daysAgo(3), rotationInterval: '48h' })],
      });

      await expect(service.rotateIfDue()).rejects.toBeInstanceOf(
        EncryptionKeyNotConfiguredException,
      );
      expect(repository.insert).not.toHaveBeenCalled();
    });
  });
});
