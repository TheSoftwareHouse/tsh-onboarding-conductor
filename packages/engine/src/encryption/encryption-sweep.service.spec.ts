import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { AuditRepository } from '../audit/audit.repository';
import { AuditService } from '../audit/audit.service';
import { AuditLogEntity } from '../audit/entity/audit-log.entity';
import { AppConfig, AppMode } from '../config/app.config';
import { OnboardingEntity } from '../onboardings/entity/onboarding.entity';
import { EncryptionKeyRingService } from './encryption-key-ring.service';
import { EncryptionKeysRepository } from './encryption-keys.repository';
import { EncryptionSweepService } from './encryption-sweep.service';
import { EncryptionFailedError } from './errors/encryption-failed.error';

const ACTIVE_KEY = 'key-active';
const OLD_KEY = 'key-old';
const UPDATED_AT = new Date('2026-02-03T04:05:06.000Z');

type AuditedInput = { action: string; resourceId: string; metadata: Record<string, unknown> };

describe('EncryptionSweepService', () => {
  const waitForImmediatePoll = async () => {
    for (let index = 0; index < 50; index += 1) {
      await Promise.resolve();
    }
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const createHarness = (
    options: {
      mode?: AppMode;
      keyConfigured?: boolean;
      pollIntervalMs?: number;
      batchSize?: number;
      refreshIntervalMs?: number;
      /** What `countSweepStatus` reports as pending before any claim on this tick. */
      pending?: number;
      /** `null` models encryption turned off: the sweep decrypts toward plain JSON. */
      activeKeyId?: string | null;
      resolvableKeyIds?: string[];
      latestDeactivatedKeyId?: string | null;
    } = {},
  ) => {
    const mode = options.mode ?? AppMode.WORKER_ONLY;
    const pollIntervalMs = options.pollIntervalMs ?? 1000;
    const batchSize = options.batchSize ?? 100;
    // Zero by default so only the very first ("observation") tick is deferred by the start delay
    // and every subsequent tick in most tests proceeds; the delay itself gets its own `describe`
    // block below with realistic, non-zero values.
    const refreshIntervalMs = options.refreshIntervalMs ?? 0;

    const onboardingRepositoryMock = {
      findOneByOrFail: jest.fn().mockImplementation(async ({ id }: { id: string }) =>
        Object.assign(new OnboardingEntity(), {
          id,
          context: { applicantId: id },
          updatedAt: UPDATED_AT,
        }),
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    // A minimal fake of the audit log's own existence check, backing `hasRecordedEncryptionEvent`:
    // `auditRepository.insert` below records `${action}:${resourceId}` into this set, and `count`
    // reports whether it is there — so a `started` this same test run already inserted really is
    // found by a later `completed` check, exactly as against real Postgres.
    const auditedEvents = new Set<string>();

    const auditLogRepositoryMock = {
      count: jest
        .fn()
        .mockImplementation(async ({ where }: { where: { action: string; resourceId: string } }) =>
          auditedEvents.has(`${where.action}:${where.resourceId}`) ? 1 : 0,
        ),
    };

    const manager = {
      getRepository: jest
        .fn()
        .mockImplementation((entity: unknown) =>
          entity === AuditLogEntity ? auditLogRepositoryMock : onboardingRepositoryMock,
        ),
    } as unknown as EntityManager;

    const dataSource = {
      transaction: jest.fn(async (callback: (manager: EntityManager) => unknown) =>
        callback(manager),
      ),
      manager,
    } as unknown as DataSource;

    const countSweepStatusMock = jest
      .fn()
      .mockResolvedValue({ pending: options.pending ?? 0, total: options.pending ?? 0 });
    // Delegates to `countSweepStatus`'s current resolution by default, so a test that never
    // touches the steady-state probe directly sees the probe agree with the count.
    const hasPendingSweepMock = jest.fn().mockImplementation(async () => {
      const { pending } = (await countSweepStatusMock()) as { pending: number };
      return pending > 0;
    });

    const repository = {
      claimPendingSweepIds: jest.fn().mockResolvedValue([]),
      countSweepStatus: countSweepStatusMock,
      hasPendingSweep: hasPendingSweepMock,
      lockSweepAudit: jest.fn().mockResolvedValue(undefined),
    } as unknown as EncryptionKeysRepository;

    const activeKeyId = options.activeKeyId === undefined ? ACTIVE_KEY : options.activeKeyId;
    const keyRing = {
      isKeyEncryptionKeyConfigured: jest.fn().mockReturnValue(options.keyConfigured ?? true),
      activeKeyId: jest.fn().mockReturnValue(activeKeyId),
      resolvableKeyIds: jest
        .fn()
        .mockReturnValue(
          options.resolvableKeyIds ?? [ACTIVE_KEY, OLD_KEY].filter((id) => id !== null),
        ),
      latestDeactivatedKeyId: jest.fn().mockReturnValue(options.latestDeactivatedKeyId ?? null),
    } as unknown as EncryptionKeyRingService;

    const auditService = {
      logEncryption: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;

    const auditRepository = {
      insert: jest.fn().mockImplementation(async (_manager: unknown, input: AuditedInput) => {
        auditedEvents.add(`${input.action}:${input.resourceId}`);
        return undefined;
      }),
    } as unknown as AuditRepository;

    const configService = {
      getOrThrow: jest.fn().mockImplementation((key: keyof AppConfig) => {
        switch (key) {
          case 'MODE':
            return mode;
          case 'ENCRYPTION_SWEEP_POLL_INTERVAL_MS':
            return pollIntervalMs;
          case 'ENCRYPTION_SWEEP_BATCH_SIZE':
            return batchSize;
          case 'ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS':
            return refreshIntervalMs;
          default:
            throw new Error(`Unexpected config key: ${String(key)}`);
        }
      }),
    } as unknown as ConfigService<AppConfig, true>;

    const service = new EncryptionSweepService(
      repository,
      keyRing,
      dataSource,
      configService,
      auditRepository,
      auditService,
    );

    const insertedActions = (action: string): AuditedInput[] =>
      (auditRepository.insert as jest.Mock).mock.calls
        .map(([, input]) => input as AuditedInput)
        .filter((input) => input.action === action);

    return {
      service,
      repository: repository as unknown as {
        claimPendingSweepIds: jest.Mock;
        countSweepStatus: jest.Mock;
        hasPendingSweep: jest.Mock;
        lockSweepAudit: jest.Mock;
      },
      keyRing: keyRing as unknown as {
        activeKeyId: jest.Mock;
        resolvableKeyIds: jest.Mock;
        latestDeactivatedKeyId: jest.Mock;
      },
      dataSource: dataSource as unknown as { transaction: jest.Mock },
      manager,
      onboardingRepositoryMock,
      auditedEvents,
      auditService: auditService as unknown as { logEncryption: jest.Mock },
      auditRepository: auditRepository as unknown as { insert: jest.Mock },
      configService: configService as unknown as { getOrThrow: jest.Mock },
      insertedActions,
    };
  };

  /** Runs the deferred observation tick, then one real tick. */
  const startAndTick = async (service: EncryptionSweepService) => {
    service.onModuleInit();
    await waitForImmediatePoll();
    jest.advanceTimersByTime(1000);
    await waitForImmediatePoll();
  };

  const tick = async () => {
    jest.advanceTimersByTime(1000);
    await waitForImmediatePoll();
  };

  describe('lifecycle', () => {
    it('does nothing at all when this process holds no key-encryption key', () => {
      const harness = createHarness({ keyConfigured: false });

      harness.service.onModuleInit();

      expect(harness.configService.getOrThrow).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('starts no timer in api-only mode', () => {
      const harness = createHarness({ mode: AppMode.API_ONLY });

      harness.service.onModuleInit();

      expect(harness.configService.getOrThrow).toHaveBeenCalledWith('MODE');
      expect(harness.configService.getOrThrow).not.toHaveBeenCalledWith(
        'ENCRYPTION_SWEEP_POLL_INTERVAL_MS',
      );
      expect(jest.getTimerCount()).toBe(0);
    });

    it.each([AppMode.WORKER_ONLY, AppMode.ALL])(
      'starts an immediate poll and an interval in %s mode',
      async (mode) => {
        const harness = createHarness({ mode });

        harness.service.onModuleInit();
        await waitForImmediatePoll();

        expect(harness.keyRing.activeKeyId).toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(1);
      },
    );

    it('clears its timer on module destroy', async () => {
      const harness = createHarness();

      harness.service.onModuleInit();
      await waitForImmediatePoll();
      expect(jest.getTimerCount()).toBe(1);

      await harness.service.onModuleDestroy();

      expect(jest.getTimerCount()).toBe(0);
    });

    it('waits for the in-flight poll before completing module destroy, and starts no new poll after shutdown begins', async () => {
      const harness = createHarness({ pending: 1 });
      let resolveCount: (() => void) | undefined;
      let destroyResolved = false;

      harness.repository.countSweepStatus.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCount = () => resolve({ pending: 1, total: 1 });
          }),
      );

      await startAndTick(harness.service); // this tick is now blocked inside the count

      const destroyPromise = harness.service.onModuleDestroy().then(() => {
        destroyResolved = true;
      });
      await waitForImmediatePoll();
      expect(destroyResolved).toBe(false);

      await tick(); // the timer is gone; no second count may start
      expect(harness.repository.countSweepStatus).toHaveBeenCalledTimes(1);

      resolveCount?.();
      await destroyPromise;

      expect(destroyResolved).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('the start delay after first observing a target', () => {
    it('does not query pending status until longer than the key-ring refresh interval has elapsed since first observing it', async () => {
      const harness = createHarness({ pollIntervalMs: 500, refreshIntervalMs: 1000, pending: 1 });

      harness.service.onModuleInit();
      await waitForImmediatePoll(); // t=0: first observes the target
      expect(harness.repository.countSweepStatus).not.toHaveBeenCalled();

      jest.advanceTimersByTime(500); // t=500, elapsed 500 <= 1000
      await waitForImmediatePoll();
      expect(harness.repository.countSweepStatus).not.toHaveBeenCalled();

      jest.advanceTimersByTime(500); // t=1000, elapsed exactly 1000 — must be longer than, not equal
      await waitForImmediatePoll();
      expect(harness.repository.countSweepStatus).not.toHaveBeenCalled();

      jest.advanceTimersByTime(500); // t=1500, elapsed 1500 > 1000
      await waitForImmediatePoll();
      expect(harness.repository.countSweepStatus).toHaveBeenCalledWith(harness.manager, ACTIVE_KEY);
    });

    it('resets the wait if the target changes before the delay elapses', async () => {
      const harness = createHarness({ pollIntervalMs: 500, refreshIntervalMs: 1000, pending: 1 });

      harness.keyRing.activeKeyId.mockReturnValue('key-a');
      harness.service.onModuleInit();
      await waitForImmediatePoll(); // observes key-a at t=0

      jest.advanceTimersByTime(500); // t=500: still key-a, elapsed 500, deferred
      await waitForImmediatePoll();

      harness.keyRing.activeKeyId.mockReturnValue('key-b'); // a rotation lands
      jest.advanceTimersByTime(500); // t=1000: sees key-b for the first time, resets the clock
      await waitForImmediatePoll();
      expect(harness.repository.countSweepStatus).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000); // t=2000: only 1000ms since observing key-b, not yet "longer than"
      await waitForImmediatePoll();
      expect(harness.repository.countSweepStatus).not.toHaveBeenCalled();

      jest.advanceTimersByTime(500); // t=2500: 1500ms since observing key-b — past the delay
      await waitForImmediatePoll();
      expect(harness.repository.countSweepStatus).toHaveBeenCalledWith(harness.manager, 'key-b');
    });
  });

  describe('the target', () => {
    it('moves rows onto the active key, off every other key it can read, while encryption is on', async () => {
      const harness = createHarness({
        pending: 1,
        resolvableKeyIds: [ACTIVE_KEY, OLD_KEY, 'older'],
      });

      await startAndTick(harness.service);

      expect(harness.repository.claimPendingSweepIds).toHaveBeenCalledWith(
        harness.manager,
        { activeKeyId: ACTIVE_KEY, sourceKeyIds: [OLD_KEY, 'older'] },
        100,
        [],
      );
    });

    it('moves rows off every key it can read, toward plain JSON, while encryption is off', async () => {
      const harness = createHarness({
        pending: 1,
        activeKeyId: null,
        resolvableKeyIds: [OLD_KEY],
        latestDeactivatedKeyId: OLD_KEY,
      });

      await startAndTick(harness.service);

      expect(harness.repository.countSweepStatus).toHaveBeenCalledWith(harness.manager, null);
      expect(harness.repository.claimPendingSweepIds).toHaveBeenCalledWith(
        harness.manager,
        { activeKeyId: null, sourceKeyIds: [OLD_KEY] },
        100,
        [],
      );
    });
  });

  describe('moving a row', () => {
    it('loads each claimed row through the entity and writes it back with update(), never save()', async () => {
      // `save()` would diff the (unchanged) decrypted value against a freshly reloaded copy and
      // silently skip the write; only `update()` reaches the transformer unconditionally.
      const harness = createHarness({ pending: 1 });
      harness.repository.claimPendingSweepIds.mockResolvedValueOnce(['o1']);

      await startAndTick(harness.service);

      expect(harness.onboardingRepositoryMock.findOneByOrFail).toHaveBeenCalledWith({ id: 'o1' });
      expect(harness.onboardingRepositoryMock.update).toHaveBeenCalledWith('o1', {
        context: { applicantId: 'o1' },
        updatedAt: UPDATED_AT,
      });
      expect(harness.onboardingRepositoryMock).not.toHaveProperty('save');
    });

    it("threads the row's own updatedAt through, so TypeORM does not re-stamp it", async () => {
      // `UpdateQueryBuilder.createUpdateExpression` (TypeORM 0.3.25) appends
      // `updated_at = CURRENT_TIMESTAMP` only when `@UpdateDateColumn` is not already among the
      // partial entity's own keys.
      const harness = createHarness({ pending: 1 });
      harness.repository.claimPendingSweepIds.mockResolvedValueOnce(['o1']);

      await startAndTick(harness.service);

      const [, patch] = harness.onboardingRepositoryMock.update.mock.calls[0];
      expect(patch.updatedAt).toBe(UPDATED_AT);
    });

    it('is idempotent: a second sweep over rows already in the target state performs no second write', async () => {
      const harness = createHarness({ pending: 1 });
      harness.repository.claimPendingSweepIds
        .mockResolvedValueOnce(['o1'])
        .mockResolvedValueOnce([]); // already on the active key the second time around

      await startAndTick(harness.service);
      expect(harness.onboardingRepositoryMock.update).toHaveBeenCalledTimes(1);

      harness.repository.countSweepStatus.mockResolvedValue({ pending: 0, total: 1 });
      await tick();
      expect(harness.onboardingRepositoryMock.update).toHaveBeenCalledTimes(1);
    });

    it('skips a row whose stored value it cannot read, audits it once, and moves the rest of the batch', async () => {
      const harness = createHarness({ pending: 3 });
      harness.repository.claimPendingSweepIds.mockResolvedValueOnce(['o1', 'poison', 'o3']);
      harness.onboardingRepositoryMock.findOneByOrFail.mockImplementation(
        async ({ id }: { id: string }) => {
          if (id === 'poison') {
            throw new EncryptionFailedError('ciphertext failed authentication');
          }

          return Object.assign(new OnboardingEntity(), { id, context: {}, updatedAt: UPDATED_AT });
        },
      );

      await startAndTick(harness.service);

      expect(harness.onboardingRepositoryMock.update).toHaveBeenCalledTimes(2);
      expect(harness.onboardingRepositoryMock.update).toHaveBeenCalledWith('o1', expect.anything());
      expect(harness.onboardingRepositoryMock.update).toHaveBeenCalledWith('o3', expect.anything());
      expect(harness.auditService.logEncryption).toHaveBeenCalledTimes(1);
      expect(harness.auditService.logEncryption).toHaveBeenCalledWith(harness.dataSource, {
        action: 'encryption.reencryption_failed',
        actorType: 'system',
        actorId: 'engine',
        resourceId: ACTIVE_KEY,
        metadata: { keyId: ACTIVE_KEY, onboardingId: 'poison', reason: 'EncryptionFailedError' },
      });
    });

    it('excludes an unreadable row from every later probe and claim, so it never heads a batch again', async () => {
      const harness = createHarness({ pending: 2 });
      harness.repository.claimPendingSweepIds
        .mockResolvedValueOnce(['poison', 'o2'])
        .mockResolvedValueOnce([]);
      harness.onboardingRepositoryMock.findOneByOrFail.mockImplementation(
        async ({ id }: { id: string }) => {
          if (id === 'poison') {
            throw new EncryptionFailedError('ciphertext failed authentication');
          }

          return Object.assign(new OnboardingEntity(), { id, context: {}, updatedAt: UPDATED_AT });
        },
      );

      await startAndTick(harness.service);

      harness.repository.countSweepStatus.mockResolvedValue({ pending: 1, total: 2 }); // still counted
      await tick();

      expect(harness.repository.claimPendingSweepIds).toHaveBeenLastCalledWith(
        harness.manager,
        expect.anything(),
        100,
        ['poison'],
      );

      harness.repository.hasPendingSweep.mockResolvedValue(false); // nothing left this process can move
      await tick();
      expect(harness.repository.hasPendingSweep).toHaveBeenLastCalledWith(
        harness.manager,
        expect.anything(),
        ['poison'],
      );
      // Audited exactly once, however many ticks pass.
      expect(harness.auditService.logEncryption).toHaveBeenCalledTimes(1);
    });

    it('lets a database failure fail the whole tick, audits it, and resumes on the next tick', async () => {
      const harness = createHarness({ pending: 2 });
      harness.repository.claimPendingSweepIds
        .mockResolvedValueOnce(['batch1'])
        .mockResolvedValueOnce(['batch2'])
        .mockResolvedValueOnce([]);
      harness.onboardingRepositoryMock.update
        .mockResolvedValueOnce({ affected: 1 })
        .mockRejectedValueOnce(new Error('db down'));

      await startAndTick(harness.service); // batch1 written
      expect(harness.onboardingRepositoryMock.update).toHaveBeenNthCalledWith(
        1,
        'batch1',
        expect.anything(),
      );

      await tick(); // batch2 fails as a whole
      expect(harness.auditService.logEncryption).toHaveBeenCalledWith(
        harness.dataSource,
        expect.objectContaining({
          action: 'encryption.reencryption_failed',
          resourceId: ACTIVE_KEY,
          metadata: { keyId: ACTIVE_KEY, reason: 'Error' },
        }),
      );

      harness.repository.countSweepStatus.mockResolvedValue({ pending: 0, total: 2 });
      await tick(); // resumes
      expect(harness.repository.countSweepStatus).toHaveBeenCalledTimes(3);
    });
  });

  describe('the steady-state probe', () => {
    it('uses the full count, not the probe, while the target has not yet been found idle', async () => {
      const harness = createHarness({ pending: 1 });
      harness.repository.claimPendingSweepIds.mockResolvedValue(['o1']);

      await startAndTick(harness.service);

      expect(harness.repository.countSweepStatus).toHaveBeenCalledTimes(1);
      expect(harness.repository.hasPendingSweep).not.toHaveBeenCalled();
    });

    it('switches to the probe once a count found nothing pending, and stays there while the probe agrees', async () => {
      const harness = createHarness({ pending: 0 });

      await startAndTick(harness.service); // confirms pending 0 via the full count
      expect(harness.repository.countSweepStatus).toHaveBeenCalledTimes(1);
      expect(harness.repository.hasPendingSweep).not.toHaveBeenCalled();

      harness.repository.hasPendingSweep.mockResolvedValue(false);
      await tick();
      expect(harness.repository.hasPendingSweep).toHaveBeenCalledTimes(1);
      expect(harness.repository.hasPendingSweep).toHaveBeenCalledWith(
        harness.manager,
        { activeKeyId: ACTIVE_KEY, sourceKeyIds: [OLD_KEY] },
        [],
      );
      expect(harness.repository.countSweepStatus).toHaveBeenCalledTimes(1);

      await tick();
      expect(harness.repository.hasPendingSweep).toHaveBeenCalledTimes(2);
      expect(harness.repository.countSweepStatus).toHaveBeenCalledTimes(1);
    });

    it('switches to the probe once a claim comes back empty while rows are still pending, since a peer holds them', async () => {
      const harness = createHarness({ pending: 5 });
      harness.repository.claimPendingSweepIds.mockResolvedValue([]);

      await startAndTick(harness.service);
      expect(harness.repository.countSweepStatus).toHaveBeenCalledTimes(1);

      harness.repository.hasPendingSweep.mockResolvedValue(false);
      await tick();
      expect(harness.repository.hasPendingSweep).toHaveBeenCalledTimes(1);
      expect(harness.repository.countSweepStatus).toHaveBeenCalledTimes(1);
    });

    it('falls back to the full count once the probe finds new work', async () => {
      const harness = createHarness({ pending: 0 });

      await startAndTick(harness.service);

      harness.repository.hasPendingSweep.mockResolvedValue(false);
      await tick();
      expect(harness.repository.countSweepStatus).toHaveBeenCalledTimes(1);

      harness.repository.hasPendingSweep.mockResolvedValue(true);
      harness.repository.countSweepStatus.mockResolvedValue({ pending: 2, total: 2 });
      await tick();
      expect(harness.repository.hasPendingSweep).toHaveBeenCalledTimes(2);
      expect(harness.repository.countSweepStatus).toHaveBeenCalledTimes(2);
    });
  });

  describe('auditing', () => {
    it('never records completed without a started, when this process booted mid-sweep and no started was ever recorded', async () => {
      const harness = createHarness({ pending: 2 });
      harness.repository.claimPendingSweepIds
        .mockResolvedValueOnce(['o1'])
        .mockResolvedValueOnce(['o2'])
        .mockResolvedValueOnce([]);

      await startAndTick(harness.service); // first reading after boot: no baseline, not a 0-to-positive
      harness.repository.countSweepStatus.mockResolvedValue({ pending: 1, total: 2 });
      await tick();
      harness.repository.countSweepStatus.mockResolvedValue({ pending: 0, total: 2 });
      await tick();

      // No baseline, so this process never attempts `started` for a sweep it cannot prove began
      // during its own lifetime; and since no peer recorded one either, `completed` is refused.
      expect(harness.insertedActions('encryption.reencryption_started')).toHaveLength(0);
      expect(harness.insertedActions('encryption.reencryption_completed')).toHaveLength(0);
    });

    it('audits started exactly once per sweep, not once per tick, then completed once, when this process observes the sweep begin', async () => {
      const harness = createHarness({ pending: 0 });
      harness.repository.claimPendingSweepIds
        .mockResolvedValueOnce(['o1'])
        .mockResolvedValueOnce(['o2'])
        .mockResolvedValueOnce([]);

      await startAndTick(harness.service); // baseline recorded as 0
      expect(harness.auditRepository.insert).not.toHaveBeenCalled();

      harness.repository.countSweepStatus.mockResolvedValue({ pending: 2, total: 2 });
      harness.repository.hasPendingSweep.mockResolvedValue(true);
      await tick(); // encryption turned on: 0 -> 2, batch 1
      harness.repository.countSweepStatus.mockResolvedValue({ pending: 1, total: 2 });
      await tick(); // batch 2 — same sweep, no second started
      harness.repository.countSweepStatus.mockResolvedValue({ pending: 0, total: 2 });
      await tick(); // done

      expect(harness.insertedActions('encryption.reencryption_started')).toEqual([
        expect.objectContaining({
          resourceId: ACTIVE_KEY,
          metadata: { keyId: ACTIVE_KEY, rowsMoved: 1 },
        }),
      ]);
      expect(harness.insertedActions('encryption.reencryption_completed')).toEqual([
        expect.objectContaining({ resourceId: ACTIVE_KEY, metadata: { keyId: ACTIVE_KEY } }),
      ]);
    });

    it('records started for a rotation that lands while a previous sweep is still under way', async () => {
      // Regression: the pending baseline used to carry over across targets, so a rotation landing
      // mid-sweep saw a positive previous count and never recorded `started` — and therefore never
      // `completed` either. A change of target is a new episode with a fresh baseline.
      const harness = createHarness({ pending: 50 });
      harness.repository.claimPendingSweepIds.mockResolvedValue(['o1']);
      harness.keyRing.activeKeyId.mockReturnValue('key-a');

      await startAndTick(harness.service); // key-a: mid-sweep, no baseline, no started (as above)
      await tick();
      expect(harness.insertedActions('encryption.reencryption_started')).toHaveLength(0);

      harness.keyRing.activeKeyId.mockReturnValue('key-b'); // rotation lands with 50 still pending
      await tick(); // observes key-b, resets the clock and the baseline
      harness.repository.countSweepStatus.mockResolvedValue({ pending: 60, total: 60 });
      await tick(); // first count under key-b

      expect(harness.insertedActions('encryption.reencryption_started')).toEqual([
        expect.objectContaining({ resourceId: 'key-b' }),
      ]);

      harness.repository.countSweepStatus.mockResolvedValue({ pending: 0, total: 60 });
      await tick();
      expect(harness.insertedActions('encryption.reencryption_completed')).toEqual([
        expect.objectContaining({ resourceId: 'key-b' }),
      ]);
    });

    it('audits a decryption sweep with the decryption actions, filed against the key it retires', async () => {
      const harness = createHarness({
        pending: 0,
        activeKeyId: null,
        resolvableKeyIds: [OLD_KEY],
        latestDeactivatedKeyId: OLD_KEY,
      });
      harness.repository.claimPendingSweepIds.mockResolvedValueOnce(['o1']).mockResolvedValue([]);

      await startAndTick(harness.service); // baseline 0
      harness.repository.countSweepStatus.mockResolvedValue({ pending: 1, total: 1 });
      harness.repository.hasPendingSweep.mockResolvedValue(true);
      await tick();
      harness.repository.countSweepStatus.mockResolvedValue({ pending: 0, total: 1 });
      await tick();

      expect(harness.insertedActions('encryption.decryption_started')).toEqual([
        expect.objectContaining({
          resourceId: OLD_KEY,
          metadata: { keyId: OLD_KEY, rowsMoved: 1 },
        }),
      ]);
      expect(harness.insertedActions('encryption.decryption_completed')).toEqual([
        expect.objectContaining({ resourceId: OLD_KEY }),
      ]);
      expect(harness.insertedActions('encryption.reencryption_started')).toHaveLength(0);
    });

    it('treats turning encryption off mid-sweep as a new episode: started for the decryption, filed against the retired key', async () => {
      const harness = createHarness({ pending: 0 });
      harness.repository.claimPendingSweepIds.mockResolvedValue(['o1']);

      await startAndTick(harness.service); // on, baseline 0
      harness.repository.countSweepStatus.mockResolvedValue({ pending: 3, total: 3 });
      harness.repository.hasPendingSweep.mockResolvedValue(true);
      await tick(); // reencryption started under ACTIVE_KEY
      expect(harness.insertedActions('encryption.reencryption_started')).toHaveLength(1);

      harness.keyRing.activeKeyId.mockReturnValue(null); // turned off
      harness.keyRing.latestDeactivatedKeyId.mockReturnValue(ACTIVE_KEY);
      await tick(); // observes the new target
      await tick(); // first count toward plain JSON

      expect(harness.insertedActions('encryption.decryption_started')).toEqual([
        expect.objectContaining({ resourceId: ACTIVE_KEY }),
      ]);
      expect(harness.insertedActions('encryption.reencryption_completed')).toHaveLength(0);
    });

    it('records completed for a sweep this process did not see start, as long as the audit log already has a started for it', async () => {
      const harness = createHarness({ pending: 2 });
      harness.repository.claimPendingSweepIds.mockResolvedValueOnce(['o1']).mockResolvedValue([]);
      harness.auditedEvents.add(`encryption.reencryption_started:${ACTIVE_KEY}`);

      await startAndTick(harness.service);
      harness.repository.countSweepStatus.mockResolvedValue({ pending: 0, total: 2 });
      await tick();

      expect(harness.insertedActions('encryption.reencryption_started')).toHaveLength(0);
      expect(harness.insertedActions('encryption.reencryption_completed')).toHaveLength(1);
    });

    it('never audits completed when nothing was ever pending', async () => {
      const harness = createHarness({ pending: 0 });

      await startAndTick(harness.service);
      await tick();

      expect(harness.auditService.logEncryption).not.toHaveBeenCalled();
      expect(harness.auditRepository.insert).not.toHaveBeenCalled();
    });

    it('takes the advisory lock for the target before deciding whether to record started', async () => {
      const harness = createHarness({ pending: 0 });

      await startAndTick(harness.service); // baseline 0

      harness.repository.claimPendingSweepIds.mockResolvedValueOnce(['o1']);
      harness.repository.countSweepStatus.mockResolvedValue({ pending: 1, total: 1 });
      harness.repository.hasPendingSweep.mockResolvedValue(true);
      await tick();

      expect(harness.repository.lockSweepAudit).toHaveBeenCalledWith(
        harness.manager,
        'encryption.reencryption_started',
        ACTIVE_KEY,
      );
    });
  });
});
