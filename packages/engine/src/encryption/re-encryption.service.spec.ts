import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuditRepository } from '../audit/audit.repository';
import { AuditService } from '../audit/audit.service';
import { AuditLogEntity } from '../audit/entity/audit-log.entity';
import { AppConfig, AppMode } from '../config/app.config';
import { OnboardingEntity } from '../onboardings/entity/onboarding.entity';
import { EncryptionKeyRingService } from './encryption-key-ring.service';
import { EncryptionKeysRepository } from './encryption-keys.repository';
import { EncryptionKeyNotFoundError } from './errors/encryption-key-not-found.error';
import { ReEncryptionService } from './re-encryption.service';

describe('ReEncryptionService', () => {
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
      encryptionEnabled?: boolean;
      pollIntervalMs?: number;
      batchSize?: number;
      refreshIntervalMs?: number;
      /** Total pending count `countReEncryptionStatus` reports before any claim on this tick. */
      pending?: number;
    } = {},
  ) => {
    const mode = options.mode ?? AppMode.WORKER_ONLY;
    const encryptionEnabled = options.encryptionEnabled ?? true;
    const pollIntervalMs = options.pollIntervalMs ?? 1000;
    const batchSize = options.batchSize ?? 100;
    // Zero by default so only the very first ("observation") tick is deferred by the start
    // delay and every subsequent tick in most tests proceeds; the delay itself gets its own
    // dedicated `describe` block below with realistic, non-zero values.
    const refreshIntervalMs = options.refreshIntervalMs ?? 0;

    const onboardingRepositoryMock = {
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    // A minimal fake of the audit log's own existence check, backing `hasRecordedEncryptionEvent`:
    // `auditRepository.insert` below records `${action}:${resourceId}` into this set, and `count`
    // reports whether it is there. This is what lets `recordStartedOnce`/`recordCompletedOnce`
    // behave exactly as they would against real Postgres — a `started` this same test run already
    // inserted really is found by a later `completed` check — without hand-rolling that behaviour
    // differently in every test.
    const auditedEvents = new Set<string>();

    const auditLogRepositoryMock = {
      count: jest
        .fn()
        .mockImplementation(async ({ where }: { where: { action: string; resourceId: string } }) =>
          auditedEvents.has(`${where.action}:${where.resourceId}`) ? 1 : 0,
        ),
    };

    const manager = {
      // Dispatches on the entity class the real code asks for, the same way a real `EntityManager`
      // would: `OnboardingEntity` for the sweep's own batch write, `AuditLogEntity` for the
      // audit-dedup check `hasRecordedEncryptionEvent` runs before `recordStartedOnce` /
      // `recordCompletedOnce` insert anything.
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

    const countReEncryptionStatusMock = jest
      .fn()
      .mockResolvedValue({ pending: options.pending ?? 0, total: options.pending ?? 0 });
    // Delegates to `countReEncryptionStatus`'s own current mock resolution by default, so every
    // existing test that never touches the steady-state probe directly keeps working unmodified:
    // whichever pending value a test has configured for the full count is exactly what the probe
    // reports too. The dedicated `hasPendingReEncryption` describe block below overrides this
    // default to exercise the probe independently.
    const hasPendingReEncryptionMock = jest.fn().mockImplementation(async (...args: unknown[]) => {
      const { pending } = (await (
        countReEncryptionStatusMock as (...callArgs: unknown[]) => Promise<{ pending: number }>
      )(...args)) as { pending: number };
      return pending > 0;
    });

    const repository = {
      claimPendingReEncryptionIds: jest.fn().mockResolvedValue([]),
      countReEncryptionStatus: countReEncryptionStatusMock,
      hasPendingReEncryption: hasPendingReEncryptionMock,
      lockReEncryptionAudit: jest.fn().mockResolvedValue(undefined),
    } as unknown as EncryptionKeysRepository;

    const keyRing = {
      activeKeyId: jest.fn().mockReturnValue('key-active'),
    } as unknown as EncryptionKeyRingService;

    const auditService = {
      logEncryption: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;

    const auditRepository = {
      insert: jest
        .fn()
        .mockImplementation(
          async (_manager: unknown, input: { action: string; resourceId: string }) => {
            auditedEvents.add(`${input.action}:${input.resourceId}`);
            return undefined;
          },
        ),
    } as unknown as AuditRepository;

    const configService = {
      get: jest.fn().mockImplementation((key: keyof AppConfig) => {
        if (key === 'ENCRYPTION_ENABLED') {
          return encryptionEnabled;
        }
        throw new Error(`Unexpected config get: ${String(key)}`);
      }),
      getOrThrow: jest.fn().mockImplementation((key: keyof AppConfig) => {
        switch (key) {
          case 'MODE':
            return mode;
          case 'ENCRYPTION_REENCRYPTION_POLL_INTERVAL_MS':
            return pollIntervalMs;
          case 'ENCRYPTION_REENCRYPTION_BATCH_SIZE':
            return batchSize;
          case 'ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS':
            return refreshIntervalMs;
          default:
            throw new Error(`Unexpected config key: ${String(key)}`);
        }
      }),
    } as unknown as ConfigService<AppConfig, true>;

    const service = new ReEncryptionService(
      repository,
      keyRing,
      dataSource,
      configService,
      auditRepository,
      auditService,
    );

    return {
      service,
      repository: repository as unknown as {
        claimPendingReEncryptionIds: jest.Mock;
        countReEncryptionStatus: jest.Mock;
        hasPendingReEncryption: jest.Mock;
        lockReEncryptionAudit: jest.Mock;
      },
      keyRing: keyRing as unknown as { activeKeyId: jest.Mock },
      dataSource: dataSource as unknown as { transaction: jest.Mock },
      manager,
      onboardingRepositoryMock,
      auditLogRepositoryMock,
      auditedEvents,
      auditService: auditService as unknown as { logEncryption: jest.Mock },
      auditRepository: auditRepository as unknown as { insert: jest.Mock },
      configService: configService as unknown as { get: jest.Mock; getOrThrow: jest.Mock },
    };
  };

  describe('lifecycle', () => {
    it('does nothing at all when encryption is disabled', () => {
      const harness = createHarness({ encryptionEnabled: false });

      harness.service.onModuleInit();

      expect(harness.configService.get).toHaveBeenCalledWith('ENCRYPTION_ENABLED', {
        infer: true,
      });
      expect(harness.configService.getOrThrow).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('starts no timer in api-only mode', () => {
      const harness = createHarness({ mode: AppMode.API_ONLY });

      harness.service.onModuleInit();

      expect(harness.configService.getOrThrow).toHaveBeenCalledWith('MODE');
      expect(harness.configService.getOrThrow).not.toHaveBeenCalledWith(
        'ENCRYPTION_REENCRYPTION_POLL_INTERVAL_MS',
      );
      expect(jest.getTimerCount()).toBe(0);
    });

    it('starts an immediate poll and interval in worker-only mode', async () => {
      const harness = createHarness({ mode: AppMode.WORKER_ONLY });

      harness.service.onModuleInit();
      await waitForImmediatePoll();

      expect(harness.keyRing.activeKeyId).toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(1);
    });

    it('starts an immediate poll and interval in all mode', async () => {
      const harness = createHarness({ mode: AppMode.ALL });

      harness.service.onModuleInit();
      await waitForImmediatePoll();

      expect(harness.keyRing.activeKeyId).toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(1);
    });

    it('clears its timer on module destroy', async () => {
      const harness = createHarness();

      harness.service.onModuleInit();
      await waitForImmediatePoll();
      expect(jest.getTimerCount()).toBe(1);

      await harness.service.onModuleDestroy();

      expect(jest.getTimerCount()).toBe(0);
    });

    it('waits for the in-flight poll before completing module destroy', async () => {
      const harness = createHarness({ pending: 1 });
      let resolveCount: (() => void) | undefined;
      let destroyResolved = false;

      harness.repository.countReEncryptionStatus.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCount = () => resolve({ pending: 1, total: 1 });
          }),
      );

      harness.service.onModuleInit();
      await waitForImmediatePoll(); // observation tick: deferred, no count call yet

      jest.advanceTimersByTime(1000); // triggers the tick that actually calls countReEncryptionStatus
      await waitForImmediatePoll();

      const destroyPromise = harness.service.onModuleDestroy().then(() => {
        destroyResolved = true;
      });
      await waitForImmediatePoll();
      expect(destroyResolved).toBe(false);

      resolveCount?.();
      await destroyPromise;

      expect(destroyResolved).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('does not start a new timer-triggered poll after shutdown begins', async () => {
      const harness = createHarness({ pending: 1 });
      let resolveCount: (() => void) | undefined;

      harness.repository.countReEncryptionStatus.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCount = () => resolve({ pending: 1, total: 1 });
          }),
      );

      harness.service.onModuleInit();
      await waitForImmediatePoll();
      jest.advanceTimersByTime(1000);
      await waitForImmediatePoll();

      const destroyPromise = harness.service.onModuleDestroy();

      jest.advanceTimersByTime(1000);
      await waitForImmediatePoll();

      expect(harness.repository.countReEncryptionStatus).toHaveBeenCalledTimes(1);

      resolveCount?.();
      await destroyPromise;

      expect(jest.getTimerCount()).toBe(0);
      expect(harness.repository.countReEncryptionStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe('the start delay after first observing an active key', () => {
    it('does not query pending status until longer than the key-ring refresh interval has elapsed since first observing it', async () => {
      const harness = createHarness({ pollIntervalMs: 500, refreshIntervalMs: 1000, pending: 1 });

      harness.service.onModuleInit();
      await waitForImmediatePoll(); // t=0: first observes the active key
      expect(harness.repository.countReEncryptionStatus).not.toHaveBeenCalled();

      jest.advanceTimersByTime(500); // t=500, elapsed 500 <= 1000
      await waitForImmediatePoll();
      expect(harness.repository.countReEncryptionStatus).not.toHaveBeenCalled();

      jest.advanceTimersByTime(500); // t=1000, elapsed exactly 1000 — must be longer than, not equal
      await waitForImmediatePoll();
      expect(harness.repository.countReEncryptionStatus).not.toHaveBeenCalled();

      jest.advanceTimersByTime(500); // t=1500, elapsed 1500 > 1000
      await waitForImmediatePoll();
      expect(harness.repository.countReEncryptionStatus).toHaveBeenCalledWith(
        harness.manager,
        'key-active',
      );
    });

    it('resets the wait if the active key changes before the delay elapses', async () => {
      const harness = createHarness({ pollIntervalMs: 500, refreshIntervalMs: 1000, pending: 1 });

      harness.keyRing.activeKeyId.mockReturnValue('key-a');
      harness.service.onModuleInit();
      await waitForImmediatePoll(); // observes key-a at t=0

      jest.advanceTimersByTime(500); // t=500: still key-a, elapsed 500, deferred
      await waitForImmediatePoll();

      harness.keyRing.activeKeyId.mockReturnValue('key-b'); // a second rotation lands
      jest.advanceTimersByTime(500); // t=1000: sees key-b for the first time, resets the clock
      await waitForImmediatePoll();
      expect(harness.repository.countReEncryptionStatus).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000); // t=2000: only 1000ms since observing key-b, not yet "longer than"
      await waitForImmediatePoll();
      expect(harness.repository.countReEncryptionStatus).not.toHaveBeenCalled();

      jest.advanceTimersByTime(500); // t=2500: 1500ms since observing key-b — past the delay
      await waitForImmediatePoll();
      expect(harness.repository.countReEncryptionStatus).toHaveBeenCalledWith(
        harness.manager,
        'key-b',
      );
    });
  });

  describe('the sweep', () => {
    it('re-encrypts through update(), which writes even when the decrypted value is unchanged', async () => {
      // This is the regression this suite exists to prevent: `save()` re-fetches a "database
      // entity" and skips a jsonb column whose decrypted value did not change
      // (`SubjectChangedColumnsComputer.computeDiffColumns`, TypeORM 0.3.25) — which is always the
      // case for a re-encryption, since only the ciphertext changes, never the plaintext. Only
      // `update()` reaches the transformer (and therefore `EncryptionPort.encrypt`)
      // unconditionally. This spec cannot observe TypeORM's real diffing (the repository is
      // mocked), so what it proves is the service's own contract: every claimed row is written
      // with `update(id, { context })`, and `save` is never called at all.
      const harness = createHarness({ pending: 1 });
      const sameContextReference = { applicantId: 'unchanged' };
      const entity = { id: 'o1', context: sameContextReference } as unknown as OnboardingEntity;
      harness.repository.claimPendingReEncryptionIds.mockResolvedValueOnce(['o1']);
      harness.onboardingRepositoryMock.find.mockResolvedValueOnce([entity]);

      harness.service.onModuleInit();
      await waitForImmediatePoll(); // deferred observation tick

      jest.advanceTimersByTime(1000);
      await waitForImmediatePoll();

      expect(harness.onboardingRepositoryMock.update).toHaveBeenCalledWith('o1', {
        context: sameContextReference,
      });
      expect(harness.onboardingRepositoryMock).not.toHaveProperty('save');
    });

    it('is idempotent: a second sweep over already-migrated rows performs no second write', async () => {
      const harness = createHarness({ pending: 1 });
      const context = { applicantId: 'unchanged' };
      const entity = { id: 'o1', context } as unknown as OnboardingEntity;
      harness.repository.claimPendingReEncryptionIds
        .mockResolvedValueOnce(['o1'])
        .mockResolvedValueOnce([]); // already on the active key the second time around
      harness.onboardingRepositoryMock.find.mockResolvedValueOnce([entity]);

      harness.service.onModuleInit();
      await waitForImmediatePoll(); // deferred observation tick

      jest.advanceTimersByTime(1000); // first real tick: re-encrypts o1
      await waitForImmediatePoll();
      expect(harness.onboardingRepositoryMock.update).toHaveBeenCalledTimes(1);
      expect(harness.onboardingRepositoryMock.update).toHaveBeenCalledWith('o1', { context });

      harness.repository.countReEncryptionStatus.mockResolvedValue({ pending: 0, total: 1 });
      jest.advanceTimersByTime(1000); // second tick: nothing left pending
      await waitForImmediatePoll();
      expect(harness.onboardingRepositoryMock.update).toHaveBeenCalledTimes(1);
    });

    it('loads and writes exactly the ids the repository claims, so a row already on the active key is left untouched', async () => {
      const harness = createHarness({ pending: 1 });
      const staleEntity = { id: 'stale-1' } as OnboardingEntity;
      harness.repository.claimPendingReEncryptionIds.mockResolvedValue(['stale-1']);
      harness.onboardingRepositoryMock.find.mockResolvedValue([staleEntity]);

      harness.service.onModuleInit();
      await waitForImmediatePoll();
      jest.advanceTimersByTime(1000);
      await waitForImmediatePoll();

      // A row that already carries the active key id is never returned by the repository's
      // predicate-bound claim, so it is never part of `ids` and this service never independently
      // widens the selection beyond exactly what the repository decided was pending.
      expect(harness.onboardingRepositoryMock.find).toHaveBeenCalledWith({
        where: { id: In(['stale-1']) },
      });
      expect(harness.onboardingRepositoryMock.update).toHaveBeenCalledWith(
        'stale-1',
        expect.anything(),
      );
      expect(harness.onboardingRepositoryMock.update).toHaveBeenCalledTimes(1);
    });

    it('leaves an earlier committed batch alone when a later batch fails, and resumes on the next tick', async () => {
      const harness = createHarness({ pending: 2 });
      const batch1Entity = { id: 'batch1' } as OnboardingEntity;
      const batch2Entity = { id: 'batch2' } as OnboardingEntity;

      harness.repository.claimPendingReEncryptionIds
        .mockResolvedValueOnce(['batch1'])
        .mockResolvedValueOnce(['batch2'])
        .mockResolvedValueOnce([]);
      harness.onboardingRepositoryMock.find
        .mockResolvedValueOnce([batch1Entity])
        .mockResolvedValueOnce([batch2Entity]);
      harness.onboardingRepositoryMock.update
        .mockResolvedValueOnce({ affected: 1 })
        .mockRejectedValueOnce(new Error('db down'));

      harness.service.onModuleInit();
      await waitForImmediatePoll(); // deferred

      jest.advanceTimersByTime(1000); // batch1 saved successfully
      await waitForImmediatePoll();
      expect(harness.onboardingRepositoryMock.update).toHaveBeenNthCalledWith(1, 'batch1', {
        context: undefined,
      });

      jest.advanceTimersByTime(1000); // batch2 fails
      await waitForImmediatePoll();
      expect(harness.auditService.logEncryption).toHaveBeenCalledWith(
        harness.dataSource,
        expect.objectContaining({ action: 'encryption.reencryption_failed' }),
      );
      // batch1's write is untouched by batch2's failure, and the sweep did not stop ticking
      expect(harness.onboardingRepositoryMock.update).toHaveBeenCalledTimes(2);

      harness.repository.countReEncryptionStatus.mockResolvedValue({ pending: 0, total: 2 });
      jest.advanceTimersByTime(1000); // resumes on the next tick
      await waitForImmediatePoll();
      expect(harness.repository.countReEncryptionStatus).toHaveBeenCalledTimes(3);
    });
  });

  describe('updated_at preservation (M3)', () => {
    it("threads the entity's own updatedAt through the write, so TypeORM does not re-stamp it", async () => {
      // `UpdateQueryBuilder.createUpdateExpression` (TypeORM 0.3.25) appends
      // `updated_at = CURRENT_TIMESTAMP` only when `@UpdateDateColumn` is not already among the
      // partial entity's own keys. Naming `updatedAt` in the call with the row's current value is
      // what keeps a rotation from making every swept onboarding read as just-updated on the
      // operator-facing list.
      const harness = createHarness({ pending: 1 });
      const existingUpdatedAt = new Date('2026-02-03T04:05:06.000Z');
      const entity = {
        id: 'o1',
        context: { applicantId: 'a' },
        updatedAt: existingUpdatedAt,
      } as unknown as OnboardingEntity;
      harness.repository.claimPendingReEncryptionIds.mockResolvedValueOnce(['o1']);
      harness.onboardingRepositoryMock.find.mockResolvedValueOnce([entity]);

      harness.service.onModuleInit();
      await waitForImmediatePoll();
      jest.advanceTimersByTime(1000);
      await waitForImmediatePoll();

      expect(harness.onboardingRepositoryMock.update).toHaveBeenCalledWith('o1', {
        context: entity.context,
        updatedAt: existingUpdatedAt,
      });
    });
  });

  describe('the steady-state pending probe (M2)', () => {
    it('uses countReEncryptionStatus, not the cheap probe, while a key has not yet been confirmed empty', async () => {
      const harness = createHarness({ pending: 1 });

      harness.service.onModuleInit();
      await waitForImmediatePoll();
      jest.advanceTimersByTime(1000);
      await waitForImmediatePoll();

      expect(harness.repository.countReEncryptionStatus).toHaveBeenCalledTimes(1);
      expect(harness.repository.hasPendingReEncryption).not.toHaveBeenCalled();
    });

    it('switches to the cheap existence probe once a tick has confirmed the key has nothing pending, instead of running the full count again', async () => {
      const harness = createHarness({ pending: 0 });

      harness.service.onModuleInit();
      await waitForImmediatePoll(); // deferred observation tick

      jest.advanceTimersByTime(1000); // first real tick: confirms pending 0 via the full count
      await waitForImmediatePoll();
      expect(harness.repository.countReEncryptionStatus).toHaveBeenCalledTimes(1);
      expect(harness.repository.hasPendingReEncryption).not.toHaveBeenCalled();

      harness.repository.hasPendingReEncryption.mockResolvedValue(false); // steady state
      jest.advanceTimersByTime(1000); // steady state: must use the cheap probe now
      await waitForImmediatePoll();
      expect(harness.repository.hasPendingReEncryption).toHaveBeenCalledTimes(1);
      expect(harness.repository.hasPendingReEncryption).toHaveBeenCalledWith(
        harness.manager,
        'key-active',
      );
      // The full, unconditional count must not run again on a tick where the probe alone
      // establishes there is nothing to do — this is the fix for the sequential-scan-on-every-tick
      // finding.
      expect(harness.repository.countReEncryptionStatus).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1000); // still steady state on the third tick
      await waitForImmediatePoll();
      expect(harness.repository.hasPendingReEncryption).toHaveBeenCalledTimes(2);
      expect(harness.repository.countReEncryptionStatus).toHaveBeenCalledTimes(1);
    });

    it('falls back to the full count once the probe finds new work after being in the steady state', async () => {
      const harness = createHarness({ pending: 0 });

      harness.service.onModuleInit();
      await waitForImmediatePoll();

      jest.advanceTimersByTime(1000); // confirms empty
      await waitForImmediatePoll();
      expect(harness.repository.countReEncryptionStatus).toHaveBeenCalledTimes(1);

      harness.repository.hasPendingReEncryption.mockResolvedValue(false);
      jest.advanceTimersByTime(1000); // steady state: probe only
      await waitForImmediatePoll();
      expect(harness.repository.hasPendingReEncryption).toHaveBeenCalledTimes(1);
      expect(harness.repository.countReEncryptionStatus).toHaveBeenCalledTimes(1);

      // New work appears: a fresh rotation put rows back on a non-active key.
      harness.repository.hasPendingReEncryption.mockResolvedValue(true);
      harness.repository.countReEncryptionStatus.mockResolvedValue({ pending: 2, total: 2 });

      jest.advanceTimersByTime(1000); // probe now reports pending work, so the full count must run
      await waitForImmediatePoll();
      expect(harness.repository.hasPendingReEncryption).toHaveBeenCalledTimes(2);
      expect(harness.repository.countReEncryptionStatus).toHaveBeenCalledTimes(2);
    });
  });

  describe('auditing', () => {
    it('never records completed without a started, when this process booted mid-rotation and no started was ever recorded', async () => {
      const harness = createHarness({ pending: 2 });
      harness.repository.claimPendingReEncryptionIds
        .mockResolvedValueOnce(['o1'])
        .mockResolvedValueOnce(['o2'])
        .mockResolvedValueOnce([]);
      harness.onboardingRepositoryMock.find
        .mockResolvedValueOnce([{ id: 'o1' } as OnboardingEntity])
        .mockResolvedValueOnce([{ id: 'o2' } as OnboardingEntity]);

      harness.service.onModuleInit();
      await waitForImmediatePoll(); // deferred

      jest.advanceTimersByTime(1000); // batch 1: previousPending undefined -> pending 2 (not a 0->>0 transition)
      await waitForImmediatePoll();

      harness.repository.countReEncryptionStatus.mockResolvedValue({ pending: 1, total: 2 });
      jest.advanceTimersByTime(1000); // batch 2
      await waitForImmediatePoll();

      harness.repository.countReEncryptionStatus.mockResolvedValue({ pending: 0, total: 2 });
      jest.advanceTimersByTime(1000); // finds none remaining
      await waitForImmediatePoll();

      const startedCalls = harness.auditRepository.insert.mock.calls.filter(
        ([, input]) => (input as { action: string }).action === 'encryption.reencryption_started',
      );
      const completedCalls = harness.auditRepository.insert.mock.calls.filter(
        ([, input]) => (input as { action: string }).action === 'encryption.reencryption_completed',
      );

      // The very first observation after boot has no prior baseline (`previousPending` is
      // `undefined`, not `0`), so this process never even attempts `started` for a rotation it
      // cannot prove began during its own lifetime — see the doc comment on
      // `lastObservedPendingCount`. Because no *other* process recorded `started` for this key
      // either (the audit log genuinely has none), `recordCompletedOnce` must refuse `completed`
      // too — recording it alone would be exactly the bug this fix closes.
      expect(startedCalls).toHaveLength(0);
      expect(completedCalls).toHaveLength(0);
    });

    it('audits reencryption_started exactly once per rotation, not once per tick, when this process observes the rotation begin', async () => {
      const harness = createHarness({ pending: 0 });
      harness.repository.claimPendingReEncryptionIds
        .mockResolvedValueOnce(['o1'])
        .mockResolvedValueOnce(['o2'])
        .mockResolvedValueOnce([]);
      harness.onboardingRepositoryMock.find
        .mockResolvedValueOnce([{ id: 'o1' } as OnboardingEntity])
        .mockResolvedValueOnce([{ id: 'o2' } as OnboardingEntity]);

      harness.service.onModuleInit();
      await waitForImmediatePoll(); // deferred observation tick (pending never queried yet)

      jest.advanceTimersByTime(1000); // tick: pending is 0, nothing to do, baseline recorded as 0
      await waitForImmediatePoll();
      expect(harness.auditRepository.insert).not.toHaveBeenCalled();

      harness.repository.countReEncryptionStatus.mockResolvedValue({ pending: 2, total: 2 });
      jest.advanceTimersByTime(1000); // a key was rotated: previous tick's baseline was 0, now 2 — batch 1
      await waitForImmediatePoll();

      harness.repository.countReEncryptionStatus.mockResolvedValue({ pending: 1, total: 2 });
      jest.advanceTimersByTime(1000); // batch 2 — still the same rotation, must not re-audit "started"
      await waitForImmediatePoll();

      harness.repository.countReEncryptionStatus.mockResolvedValue({ pending: 0, total: 2 });
      jest.advanceTimersByTime(1000); // finds none remaining
      await waitForImmediatePoll();

      const startedCalls = harness.auditRepository.insert.mock.calls.filter(
        ([, input]) => (input as { action: string }).action === 'encryption.reencryption_started',
      );
      const completedCalls = harness.auditRepository.insert.mock.calls.filter(
        ([, input]) => (input as { action: string }).action === 'encryption.reencryption_completed',
      );

      expect(startedCalls).toHaveLength(1);
      expect(completedCalls).toHaveLength(1);
    });

    it('records completed for a rotation this process did not see start, as long as the audit log already has a started for it', async () => {
      // Models the case a single-process test cannot otherwise reach: some other replica recorded
      // `started` for this key before this process ever looked (or before this process's own
      // simulated restart). The audit log — not this process's memory — is what makes `completed`
      // legitimate here.
      const harness = createHarness({ pending: 2 });
      harness.repository.claimPendingReEncryptionIds
        .mockResolvedValueOnce(['o1'])
        .mockResolvedValueOnce(['o2'])
        .mockResolvedValueOnce([]);
      harness.onboardingRepositoryMock.find
        .mockResolvedValueOnce([{ id: 'o1' } as OnboardingEntity])
        .mockResolvedValueOnce([{ id: 'o2' } as OnboardingEntity]);
      harness.auditedEvents.add('encryption.reencryption_started:key-active');

      harness.service.onModuleInit();
      await waitForImmediatePoll();

      jest.advanceTimersByTime(1000); // batch 1
      await waitForImmediatePoll();

      harness.repository.countReEncryptionStatus.mockResolvedValue({ pending: 1, total: 2 });
      jest.advanceTimersByTime(1000); // batch 2
      await waitForImmediatePoll();

      harness.repository.countReEncryptionStatus.mockResolvedValue({ pending: 0, total: 2 });
      jest.advanceTimersByTime(1000); // finds none remaining
      await waitForImmediatePoll();

      const startedCalls = harness.auditRepository.insert.mock.calls.filter(
        ([, input]) => (input as { action: string }).action === 'encryption.reencryption_started',
      );
      const completedCalls = harness.auditRepository.insert.mock.calls.filter(
        ([, input]) => (input as { action: string }).action === 'encryption.reencryption_completed',
      );

      expect(startedCalls).toHaveLength(0); // this process never inserts its own — one already exists
      expect(completedCalls).toHaveLength(1);
    });

    it('never audits reencryption_completed when nothing was ever pending', async () => {
      const harness = createHarness({ pending: 0 });

      harness.service.onModuleInit();
      await waitForImmediatePoll();
      jest.advanceTimersByTime(1000);
      await waitForImmediatePoll();

      expect(harness.auditService.logEncryption).not.toHaveBeenCalled();
      expect(harness.auditRepository.insert).not.toHaveBeenCalled();
    });

    it('does not re-audit reencryption_started after a simulated process restart mid-rotation', async () => {
      // Regression: `startedAuditedForKeyId` used to be a plain in-memory flag, so a process
      // restart mid-rotation (which loses that flag but not the still-pending rows in Postgres)
      // re-audited `reencryption_started` every time it came back up. A fresh `ReEncryptionService`
      // instance models that restart: its `lastObservedPendingCount` starts `undefined` again even
      // though the repository (standing in for Postgres) still reports the same nonzero pending
      // count left over from before the "restart".
      const harness = createHarness({ pending: 3 });
      harness.repository.claimPendingReEncryptionIds.mockResolvedValue(['o1']);
      harness.onboardingRepositoryMock.find.mockResolvedValue([{ id: 'o1' } as OnboardingEntity]);

      harness.service.onModuleInit();
      await waitForImmediatePoll();
      jest.advanceTimersByTime(1000);
      await waitForImmediatePoll();

      expect(harness.auditRepository.insert).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'encryption.reencryption_started' }),
      );
    });

    it('takes the advisory lock for the key before deciding whether to record started', async () => {
      const harness = createHarness({ pending: 0 });
      harness.onboardingRepositoryMock.find.mockResolvedValueOnce([
        { id: 'o1' } as OnboardingEntity,
      ]);

      harness.service.onModuleInit();
      await waitForImmediatePoll(); // deferred observation tick

      jest.advanceTimersByTime(1000); // first real tick: pending is 0, baseline recorded as 0
      await waitForImmediatePoll();

      harness.repository.claimPendingReEncryptionIds
        .mockResolvedValueOnce(['o1'])
        .mockResolvedValueOnce([]);
      harness.repository.countReEncryptionStatus.mockResolvedValue({ pending: 1, total: 1 });
      jest.advanceTimersByTime(1000); // the 0->1 transition
      await waitForImmediatePoll();

      expect(harness.repository.lockReEncryptionAudit).toHaveBeenCalledWith(
        harness.manager,
        'encryption.reencryption_started',
        'key-active',
      );
    });
  });

  describe('a not-yet-provisioned key ring', () => {
    it('skips the tick rather than treating a missing active key as a sweep failure', async () => {
      const harness = createHarness();
      harness.keyRing.activeKeyId.mockImplementation(() => {
        throw new EncryptionKeyNotFoundError('active');
      });

      harness.service.onModuleInit();
      await waitForImmediatePoll();

      expect(harness.repository.countReEncryptionStatus).not.toHaveBeenCalled();
      expect(harness.auditService.logEncryption).not.toHaveBeenCalled();
      expect(harness.auditRepository.insert).not.toHaveBeenCalled();
    });
  });
});
