import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import type { AuditService } from '../audit/audit.service';
import { AppConfig } from '../config/app.config';
import { EncryptionFailedError } from './errors/encryption-failed.error';
import { EncryptionKeyRingService } from './encryption-key-ring.service';
import { EncryptionKeysRepository } from './encryption-keys.repository';
import { EncryptionKeyEntity } from './entity/encryption-key.entity';
import { EncryptionKeyNotFoundError } from './errors/encryption-key-not-found.error';
import { EncryptionKeyUnwrapFailedError } from './errors/encryption-key-unwrap-failed.error';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEK = Buffer.alloc(32, 9);
const KEK_BASE64 = KEK.toString('base64');

/**
 * Wraps/unwraps independently of `EncryptionKeyRingService`, using the same scheme (AES-256-GCM,
 * the key's own id as AAD, `base64(iv || authTag || key)`), so tests can verify the service's own
 * wrap output and construct fixtures without depending on its private methods.
 */
function wrap(aad: string, dataKey: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, KEK, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

function unwrap(aad: string, wrapped: string): Buffer {
  const raw = Buffer.from(wrapped, 'base64');
  const iv = raw.subarray(0, IV_BYTES);
  const authTag = raw.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, KEK, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function fakeRow(overrides: Partial<EncryptionKeyEntity> = {}): EncryptionKeyEntity {
  return Object.assign(new EncryptionKeyEntity(), {
    id: 'key-1',
    wrappedKey: wrap('key-1', Buffer.alloc(32, 1)),
    createdAt: new Date(),
    createdBy: null,
    activatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  });
}

describe('EncryptionKeyRingService', () => {
  const manager = {} as EntityManager;
  const DEFAULT_REFRESH_INTERVAL_MS = 15000;

  // Fake timers for the whole suite so `onModuleInit`'s `setInterval` never registers a real,
  // process-level timer that outlives a test — not just for the periodic-refresh tests below.
  // Jest's fake timers only virtualize timer APIs; they do not change how microtasks/Promises
  // resolve, so the existing `await`/`flushMicrotasks` reasoning elsewhere in this file is
  // unaffected.
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const createHarness = (enabled = true, refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS) => {
    const repository = {
      insert: jest.fn().mockResolvedValue(undefined),
      findActive: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
      findAll: jest.fn().mockResolvedValue([]),
      softDeleteActive: jest.fn(),
    };

    const dataSource = { manager } as unknown as DataSource;

    const configService = {
      get: jest.fn().mockImplementation((key: keyof AppConfig) => {
        switch (key) {
          case 'ENCRYPTION_ENABLED':
            return enabled;
          case 'ENCRYPTION_KEY':
            return KEK_BASE64;
          case 'ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS':
            return refreshIntervalMs;
          default:
            throw new Error(`Unexpected config key: ${String(key)}`);
        }
      }),
    } as unknown as ConfigService<AppConfig, true>;

    const auditService = {
      logEncryption: jest.fn().mockResolvedValue(undefined),
    };

    const sut = new EncryptionKeyRingService(
      repository as unknown as EncryptionKeysRepository,
      dataSource,
      configService,
      auditService as unknown as AuditService,
    );

    return { sut, repository, configService, auditService };
  };

  /**
   * Advances past the microtask hops between a bare `await` of `reload()`'s own promise (what
   * `reloadSpy.mock.results[n].value` gives back) and the `.catch().finally()` chain `keyFor`
   * attaches to it actually running, which is what clears `reloadInFlight`.
   */
  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve();
    }
  };

  describe('wrapping and unwrapping (AAD binding)', () => {
    it('unwraps a key the ring itself wrapped to the identical 32 bytes', async () => {
      const { sut, repository } = createHarness();

      await sut.onModuleInit(); // bootstraps the first key on an empty table

      expect(repository.insert).toHaveBeenCalledTimes(1);
      const [, inserted] = repository.insert.mock.calls[0];

      // Independently unwrap what the service produced, to confirm its wrap is correct without
      // reaching into its private state.
      const independentlyUnwrapped = unwrap(inserted.id, inserted.wrappedKey);
      expect(independentlyUnwrapped).toHaveLength(32);

      repository.findAll.mockResolvedValue([
        fakeRow({ id: inserted.id, wrappedKey: inserted.wrappedKey, deletedAt: null }),
      ]);
      await sut.reload();

      expect(sut.keyFor(inserted.id)).toEqual(independentlyUnwrapped);
    });

    it('fails to unwrap a key wrapped under one id when the row stores it under another', async () => {
      const { sut, repository } = createHarness();
      const wrappedUnderKeyA = wrap('key-a', Buffer.alloc(32, 3));

      repository.findAll.mockResolvedValue([
        fakeRow({ id: 'key-b', wrappedKey: wrappedUnderKeyA, deletedAt: null }),
      ]);

      const error = await sut.reload().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(EncryptionFailedError);
    });

    it('never includes the KEK or key material in the thrown error message', async () => {
      const { sut, repository } = createHarness();
      const wrappedUnderKeyA = wrap('key-a', Buffer.alloc(32, 3));

      repository.findAll.mockResolvedValue([
        fakeRow({ id: 'key-b', wrappedKey: wrappedUnderKeyA, deletedAt: null }),
      ]);

      const error = (await sut.reload().catch((caught: unknown) => caught)) as Error;

      expect(error.message).not.toContain(KEK_BASE64);
      expect(error.message).not.toContain(wrappedUnderKeyA);
    });
  });

  describe('superseded key unwrap failures', () => {
    it('boots and completes reload when a superseded key fails to unwrap, excluding only that key', async () => {
      const loggerWarnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const { sut, repository } = createHarness();
      const active = fakeRow({
        id: 'active-key',
        deletedAt: null,
        wrappedKey: wrap('active-key', Buffer.alloc(32, 2)),
      });
      const unwrappableSuperseded = fakeRow({
        id: 'bad-old-key',
        deletedAt: new Date(Date.now() - 1000),
        // wrapped under the wrong AAD, so unwrapping it fails
        wrappedKey: wrap('someone-elses-id', Buffer.alloc(32, 6)),
      });
      repository.findAll.mockResolvedValue([active, unwrappableSuperseded]);

      await expect(sut.reload()).resolves.toBeUndefined();

      expect(sut.activeKeyId()).toBe('active-key');
      expect(sut.keyFor('active-key')).toEqual(unwrap('active-key', active.wrappedKey));
      expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
      loggerWarnSpy.mockRestore();
    });

    it('throws a distinct, named error naming the id when keyFor is asked for the excluded key', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const { sut, repository } = createHarness();
      const active = fakeRow({
        id: 'active-key',
        deletedAt: null,
        wrappedKey: wrap('active-key', Buffer.alloc(32, 2)),
      });
      const unwrappableSuperseded = fakeRow({
        id: 'bad-old-key',
        deletedAt: new Date(Date.now() - 1000),
        wrappedKey: wrap('someone-elses-id', Buffer.alloc(32, 6)),
      });
      repository.findAll.mockResolvedValue([active, unwrappableSuperseded]);

      await sut.reload();

      expect(() => sut.keyFor('bad-old-key')).toThrow(EncryptionKeyUnwrapFailedError);
      expect(() => sut.keyFor('bad-old-key')).toThrow(/bad-old-key/);
      // Distinguishable from an id the ring never saw at all.
      expect(() => sut.keyFor('never-issued')).toThrow(EncryptionKeyNotFoundError);
    });

    it('never reloads a burst of misses for an id it already knows is unwrappable', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const { sut, repository } = createHarness();
      const unwrappableSuperseded = fakeRow({
        id: 'bad-old-key',
        deletedAt: new Date(Date.now() - 1000),
        wrappedKey: wrap('someone-elses-id', Buffer.alloc(32, 6)),
      });
      repository.findAll.mockResolvedValue([unwrappableSuperseded]);
      await sut.reload();
      const reloadSpy = jest.spyOn(sut, 'reload');

      expect(() => sut.keyFor('bad-old-key')).toThrow(EncryptionKeyUnwrapFailedError);
      expect(() => sut.keyFor('bad-old-key')).toThrow(EncryptionKeyUnwrapFailedError);

      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('still throws and blocks reload when the active key itself fails to unwrap, even alongside a healthy historical key', async () => {
      const { sut, repository } = createHarness();
      const healthyHistorical = fakeRow({
        id: 'old-key',
        deletedAt: new Date(Date.now() - 1000),
        wrappedKey: wrap('old-key', Buffer.alloc(32, 4)),
      });
      const unwrappableActive = fakeRow({
        id: 'active-key',
        deletedAt: null,
        wrappedKey: wrap('someone-elses-id', Buffer.alloc(32, 7)),
      });
      repository.findAll.mockResolvedValue([healthyHistorical, unwrappableActive]);

      const error = await sut.reload().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(EncryptionFailedError);
      // The ring never applies a partial reload: the previous (empty) state is left in place
      // rather than a state missing only the active key.
      expect(() => sut.activeKeyId()).toThrow(EncryptionKeyNotFoundError);
    });

    it('leaves a healthy ring of two good keys completely unaffected', async () => {
      const { sut, repository } = createHarness();
      const active = fakeRow({
        id: 'active-key',
        deletedAt: null,
        wrappedKey: wrap('active-key', Buffer.alloc(32, 2)),
      });
      const historical = fakeRow({
        id: 'old-key',
        deletedAt: new Date(Date.now() - 1000),
        wrappedKey: wrap('old-key', Buffer.alloc(32, 4)),
      });
      repository.findAll.mockResolvedValue([active, historical]);

      await sut.reload();

      expect(sut.activeKeyId()).toBe('active-key');
      expect(sut.keyFor('active-key')).toEqual(unwrap('active-key', active.wrappedKey));
      expect(sut.keyFor('old-key')).toEqual(unwrap('old-key', historical.wrappedKey));
    });
  });

  describe('keyFor', () => {
    it('reloads exactly once on a miss, and throws again if the id is still unknown afterwards', async () => {
      const { sut, repository } = createHarness();
      const reloadSpy = jest.spyOn(sut, 'reload');
      repository.findAll.mockResolvedValue([]); // the table still has nothing for this id

      expect(() => sut.keyFor('missing')).toThrow(EncryptionKeyNotFoundError);
      expect(() => sut.keyFor('missing')).toThrow(EncryptionKeyNotFoundError); // same burst
      expect(reloadSpy).toHaveBeenCalledTimes(1); // deduped: not one reload per miss in the loop

      await reloadSpy.mock.results[0].value; // let the in-flight reload actually land
      await flushMicrotasks(); // and let its .finally() clear reloadInFlight

      expect(() => sut.keyFor('missing')).toThrow(EncryptionKeyNotFoundError); // genuinely re-checked
      expect(reloadSpy).toHaveBeenCalledTimes(2);
    });

    it('succeeds once the reloaded table actually contains the key, without reloading a third time', async () => {
      const { sut, repository } = createHarness();
      const reloadSpy = jest.spyOn(sut, 'reload');
      const row = fakeRow({ id: 'late-key', wrappedKey: wrap('late-key', Buffer.alloc(32, 5)) });

      repository.findAll.mockResolvedValue([]);
      expect(() => sut.keyFor('late-key')).toThrow(EncryptionKeyNotFoundError);
      await reloadSpy.mock.results[0].value;
      await flushMicrotasks();

      repository.findAll.mockResolvedValue([row]);
      expect(() => sut.keyFor('late-key')).toThrow(EncryptionKeyNotFoundError); // triggers reload #2
      await reloadSpy.mock.results[1].value;
      await flushMicrotasks();

      expect(sut.keyFor('late-key')).toEqual(unwrap('late-key', row.wrappedKey));
      expect(reloadSpy).toHaveBeenCalledTimes(2);
    });

    it('never reloads at all for a key already in the ring', async () => {
      const { sut, repository } = createHarness();
      const reloadSpy = jest.spyOn(sut, 'reload');
      const row = fakeRow({ id: 'known-key', wrappedKey: wrap('known-key', Buffer.alloc(32, 8)) });
      repository.findAll.mockResolvedValue([row]);
      await sut.reload();
      reloadSpy.mockClear();

      sut.keyFor('known-key');

      expect(reloadSpy).not.toHaveBeenCalled();
    });
  });

  describe('first-boot bootstrap', () => {
    it('creates exactly one active key when the table is empty', async () => {
      const { sut, repository } = createHarness();

      await sut.onModuleInit();

      expect(repository.findActive).toHaveBeenCalledTimes(1);
      expect(repository.insert).toHaveBeenCalledTimes(1);
      const [, inserted] = repository.insert.mock.calls[0];
      expect(inserted.createdBy).toBeNull();
      expect(inserted.activatedAt).toBeInstanceOf(Date);
    });

    it('creates no key when one already exists', async () => {
      const { sut, repository } = createHarness();
      repository.findActive.mockResolvedValue(fakeRow());

      await sut.onModuleInit();

      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('does nothing when encryption is disabled', async () => {
      const { sut, repository } = createHarness(false);

      await sut.onModuleInit();

      expect(repository.findActive).not.toHaveBeenCalled();
      expect(repository.insert).not.toHaveBeenCalled();
      expect(repository.findAll).not.toHaveBeenCalled();
    });

    it('defers to the winner when two replicas race to create the first key', async () => {
      const { sut, repository } = createHarness();
      const conflict = Object.assign(new Error('duplicate key value violates unique constraint'), {
        driverError: { code: '23505', constraint: 'uq_encryption_keys_active' },
      });
      repository.insert.mockRejectedValueOnce(conflict);

      await expect(sut.onModuleInit()).resolves.toBeUndefined();
    });

    it('surfaces an unrelated insert failure rather than swallowing it', async () => {
      const { sut, repository } = createHarness();
      repository.insert.mockRejectedValueOnce(new Error('connection reset'));

      await expect(sut.onModuleInit()).rejects.toThrow('connection reset');
    });

    it('audits the key it provisioned as the engine, after the insert has resolved', async () => {
      const { sut, repository, auditService } = createHarness();

      await sut.onModuleInit();
      await flushMicrotasks();

      const [, inserted] = repository.insert.mock.calls[0];
      expect(auditService.logEncryption).toHaveBeenCalledWith(expect.anything(), {
        action: 'encryption.initial_key_created',
        actorType: 'system',
        actorId: 'engine',
        resourceId: inserted.id,
        metadata: { keyId: inserted.id },
      });
    });

    it('does not audit when it lost the race to another replica', async () => {
      const { sut, repository, auditService } = createHarness();
      const conflict = Object.assign(new Error('duplicate key value violates unique constraint'), {
        driverError: { code: '23505', constraint: 'uq_encryption_keys_active' },
      });
      repository.insert.mockRejectedValueOnce(conflict);

      await sut.onModuleInit();
      await flushMicrotasks();

      expect(auditService.logEncryption).not.toHaveBeenCalled();
    });

    it('does not let a failed audit write reject onModuleInit', async () => {
      const { sut, auditService } = createHarness();
      auditService.logEncryption.mockRejectedValue(new Error('audit log unavailable'));

      await expect(sut.onModuleInit()).resolves.toBeUndefined();
      await flushMicrotasks();

      expect(auditService.logEncryption).toHaveBeenCalledTimes(1);
    });
  });

  describe('generateWrappedKey', () => {
    it('returns a fresh id and a key that unwraps to 32 bytes under that id', () => {
      const { sut } = createHarness();

      const first = sut.generateWrappedKey();
      const second = sut.generateWrappedKey();

      expect(first.id).not.toEqual(second.id);
      expect(unwrap(first.id, first.wrappedKey)).toHaveLength(32);
    });

    it('produces material that fails to unwrap under a different id', () => {
      const { sut } = createHarness();

      const { id, wrappedKey } = sut.generateWrappedKey();

      expect(() => unwrap(`${id}-other`, wrappedKey)).toThrow();
    });

    it('never touches the table or the ring', () => {
      const { sut, repository } = createHarness();

      sut.generateWrappedKey();

      expect(repository.insert).not.toHaveBeenCalled();
      expect(repository.findAll).not.toHaveBeenCalled();
    });
  });

  describe('activeKeyId', () => {
    it('returns the id of the row with a null deletedAt after reload', async () => {
      const { sut, repository } = createHarness();
      const active = fakeRow({
        id: 'active-key',
        deletedAt: null,
        wrappedKey: wrap('active-key', Buffer.alloc(32, 2)),
      });
      const deleted = fakeRow({
        id: 'old-key',
        deletedAt: new Date(),
        wrappedKey: wrap('old-key', Buffer.alloc(32, 4)),
      });
      repository.findAll.mockResolvedValue([active, deleted]);

      await sut.reload();

      expect(sut.activeKeyId()).toBe('active-key');
    });

    it('throws a named error when no active key has been loaded yet', () => {
      const { sut } = createHarness();

      expect(() => sut.activeKeyId()).toThrow(EncryptionKeyNotFoundError);
    });
  });

  describe('periodic refresh timer', () => {
    it('reloads on the configured interval', async () => {
      const { sut, repository } = createHarness(true, DEFAULT_REFRESH_INTERVAL_MS);

      await sut.onModuleInit(); // one reload already happened as part of bootstrap
      const callsAfterInit = repository.findAll.mock.calls.length;

      jest.advanceTimersByTime(DEFAULT_REFRESH_INTERVAL_MS);
      await flushMicrotasks(); // let this tick's reload settle and clear reloadInFlight
      expect(repository.findAll.mock.calls.length).toBe(callsAfterInit + 1);

      jest.advanceTimersByTime(DEFAULT_REFRESH_INTERVAL_MS);
      await flushMicrotasks();
      expect(repository.findAll.mock.calls.length).toBe(callsAfterInit + 2);
    });

    it('keeps ticking after a reload rejects instead of stopping the timer', async () => {
      const loggerErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const { sut, repository } = createHarness(true, DEFAULT_REFRESH_INTERVAL_MS);

      await sut.onModuleInit();
      const callsAfterInit = repository.findAll.mock.calls.length;

      repository.findAll.mockRejectedValueOnce(new Error('db unreachable'));

      jest.advanceTimersByTime(DEFAULT_REFRESH_INTERVAL_MS);
      await flushMicrotasks(); // let the rejection's .catch()/.finally() clear reloadInFlight
      expect(repository.findAll.mock.calls.length).toBe(callsAfterInit + 1);
      expect(loggerErrorSpy).toHaveBeenCalledTimes(1); // logged, never thrown

      jest.advanceTimersByTime(DEFAULT_REFRESH_INTERVAL_MS);
      await flushMicrotasks();
      expect(repository.findAll.mock.calls.length).toBe(callsAfterInit + 2); // still ticking

      loggerErrorSpy.mockRestore();
    });

    it('clears the timer on onModuleDestroy and awaits any in-flight reload', async () => {
      const { sut, repository } = createHarness(true, DEFAULT_REFRESH_INTERVAL_MS);

      await sut.onModuleInit();
      const callsAfterInit = repository.findAll.mock.calls.length;

      await sut.onModuleDestroy();

      jest.advanceTimersByTime(DEFAULT_REFRESH_INTERVAL_MS * 5);
      expect(repository.findAll.mock.calls.length).toBe(callsAfterInit); // no further ticks
    });

    it('starts no timer when encryption is disabled', async () => {
      const { sut, repository } = createHarness(false);

      await sut.onModuleInit();
      jest.advanceTimersByTime(DEFAULT_REFRESH_INTERVAL_MS * 10);

      expect(repository.findAll).not.toHaveBeenCalled();
    });
  });
});
