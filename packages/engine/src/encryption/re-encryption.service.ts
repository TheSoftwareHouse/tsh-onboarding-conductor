import { Injectable, Logger, Optional, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuditRepository } from '../audit/audit.repository';
import { AuditService } from '../audit/audit.service';
import {
  ENCRYPTION_KEY_RESOURCE_TYPE,
  getAuditEntryType,
  type EncryptionAuditAction,
} from '../audit/audit.types';
import { AuditLogEntity } from '../audit/entity/audit-log.entity';
import { AppConfig, AppMode } from '../config/app.config';
import { OnboardingEntity } from '../onboardings/entity/onboarding.entity';
import { EncryptionKeyRingService } from './encryption-key-ring.service';
import { EncryptionKeysRepository } from './encryption-keys.repository';
import { EncryptionKeyNotFoundError } from './errors/encryption-key-not-found.error';

/**
 * The background sweep decision 4 requires: adding a key must not leave a lagging tail of rows on
 * an older one. Modelled on `RetryService` (`src/webhook/retry.service.ts`) — same poller shape
 * (`onModuleInit` skipped in `MODE=api-only`, one immediate poll then `setInterval`, every tick
 * wrapped so a failure is logged and audited but never kills the timer, `onModuleDestroy` clearing
 * the timer and awaiting the in-flight poll) — but batched SQL rather than a queue, per the plan's
 * explicit "no BullMQ for this".
 *
 * Each tick claims up to `ENCRYPTION_REENCRYPTION_BATCH_SIZE` onboarding rows still naming a
 * non-active key (`EncryptionKeysRepository.claimPendingReEncryptionIds`, `FOR UPDATE SKIP
 * LOCKED`), loads them through `OnboardingEntity` and writes each back with
 * `Repository.update(id, { context, updatedAt })` — never raw SQL — so the column transformer
 * does the actual decrypt/re-encrypt work. `updatedAt` is passed through unchanged so this write
 * does not also stamp it; see the inline comment at the call site.
 *
 * This must be `update`, not `save`. `save()` re-queries the row to build a "database entity"
 * snapshot and diffs the new value against it (`SubjectChangedColumnsComputer.computeDiffColumns`
 * in TypeORM 0.3.25); for a `jsonb` column it compares the two *decrypted* values with
 * `OrmUtils.deepCompare` and skips the column entirely when they're equal — which they always are
 * here, since re-encryption only changes the ciphertext, never the plaintext it decrypts to. That
 * means `save()` silently never re-encrypts anything: no diff, no call to the transformer, no
 * `UPDATE` at all. `Repository.update()`'s `UpdateQueryBuilder.createUpdateExpression()` has no
 * such diff step — it calls `driver.preparePersistentValue()` (which runs the column's
 * transformer) unconditionally for every property in the partial entity — so it reaches
 * `EncryptionPort.encrypt` and issues a real `SET context = ...` every time.
 *
 * Because the claim predicate is the same one `countReEncryptionStatus` reports pending against,
 * the sweep is idempotent by construction: a row already on the active key simply never matches
 * it again, whether that is because this tick already moved it or because it was written fresh
 * after the key rotated.
 *
 * `engine` and `engine-worker` run as separate containers (`docker-compose.yml`), so the process
 * running this sweep is never guaranteed to be the one serving reads. Per "Staleness across
 * replicas" in the plan, the sweep additionally waits longer than
 * `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS` after first observing a given key as active before it
 * re-encrypts that key's first batch, so no row can end up carrying a key id other processes have
 * not yet had the chance to learn through their own periodic refresh.
 *
 * ### Cross-process audit bookkeeping
 *
 * More than one replica can run this sweep at once (nothing prevents `engine-worker` from being
 * scaled beyond one instance), so `started`/`completed` cannot be decided from per-process memory
 * alone. `lastObservedPendingCount` and `knownEmptyForKeyId` still decide *when* this process
 * bothers to check — they are what keeps a steady-state tick cheap, and a process that starts up
 * mid-rotation still does not credit itself with a `started` it did not see begin (see
 * `lastObservedPendingCount`'s doc comment) — but they no longer decide whether the row actually
 * gets written. That decision is derived from the audit log itself, the one piece of state every
 * replica already shares: `recordStartedOnce`/`recordCompletedOnce` take
 * `EncryptionKeysRepository.lockReEncryptionAudit` (the same transaction-scoped advisory lock
 * technique `ConnectorsRepository.lock` uses) for the length of one transaction, check whether the
 * row they are about to write already exists, and only insert it if not — so two replicas racing
 * to record the same step can never both observe "not yet recorded". `started` no longer requires
 * `processedCount > 0` either: it fires on the observed 0-to-positive pending transition alone, so
 * a tick that finds `pending > 0` but claims nothing this time (a peer already holds every pending
 * row's lock via `FOR UPDATE SKIP LOCKED`) still gets `started` recorded — by whichever process's
 * own transition triggers it — rather than silently skipping it the way this service used to.
 * `recordCompletedOnce` additionally refuses to record `completed` unless a `started` row already
 * exists for the same key, so a rotation a peer processed in its entirety still never ends up
 * "completed" with no "started" ever recorded for it.
 */
@Injectable()
export class ReEncryptionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReEncryptionService.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isShuttingDown = false;
  private activePollPromise: Promise<void> | null = null;

  /**
   * The active key id this process most recently observed, and when it first saw it become
   * active — the start delay's clock. `undefined` before the first tick has ever resolved an
   * active key.
   */
  private observedActiveKeyId: string | undefined;
  private observedActiveKeyAt: number | undefined;

  /**
   * The pending count this process observed on its previous tick (for the currently-observed
   * active key). `undefined` immediately after a restart, before this process has taken its own
   * reading — deliberately, so a process that starts up mid-rotation does not attempt to record
   * `encryption.reencryption_started` for a rotation it did not itself see begin. This only decides
   * *when* this process attempts the write, not whether it actually lands: see "Cross-process
   * audit bookkeeping" above for how `recordStartedOnce`/`recordCompletedOnce` make the write
   * itself exactly-once across every replica taking this same reading.
   */
  private lastObservedPendingCount: number | undefined;

  /**
   * The active key id this process most recently confirmed has nothing left pending, or
   * `undefined` if it has never confirmed that (fresh start, or the last full count found work).
   * While this equals the currently observed active key id, `sweepOnce` re-checks with
   * `hasPendingReEncryption` — a bounded, indexable probe — instead of `countReEncryptionStatus`'s
   * unconditional full-table scan, which would otherwise run on every tick forever even once a
   * rotation has long since finished. Reset to `undefined` the moment a full count finds any
   * pending row, so the next newly-observed key or freshly-discovered batch of work always goes
   * through the full count at least once before this shortcut applies again.
   */
  private knownEmptyForKeyId: string | undefined;

  constructor(
    private readonly repository: EncryptionKeysRepository,
    private readonly keyRing: EncryptionKeyRingService,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly auditRepository: AuditRepository,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  onModuleInit(): void {
    if (!this.configService.get('ENCRYPTION_ENABLED', { infer: true })) {
      return;
    }

    const mode = this.configService.getOrThrow<AppMode>('MODE');

    if (mode === AppMode.API_ONLY) {
      return;
    }

    const pollIntervalMs = this.configService.getOrThrow<number>(
      'ENCRYPTION_REENCRYPTION_POLL_INTERVAL_MS',
    );

    void this.runPoll();
    this.timer = setInterval(() => void this.runPoll(), pollIntervalMs);
  }

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await this.activePollPromise;
  }

  private async runPoll(): Promise<void> {
    if (this.isRunning || this.isShuttingDown) {
      return;
    }

    this.isRunning = true;
    const activePollPromise = this.runPollCycle();
    this.activePollPromise = activePollPromise;

    await activePollPromise;

    if (this.activePollPromise === activePollPromise) {
      this.activePollPromise = null;
    }
  }

  private async runPollCycle(): Promise<void> {
    try {
      await this.sweepOnce();
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`ENCRYPTION_REENCRYPTION_SWEEP_FAILED reason=${reason}`);
      await this.recordSweepFailed(error);
    } finally {
      this.isRunning = false;
    }
  }

  private async sweepOnce(): Promise<void> {
    const activeKeyId = this.resolveActiveKeyIdOrNull();

    if (activeKeyId === null) {
      // The ring has not resolved an active key yet (first-boot provisioning still in flight on
      // this replica). Nothing to sweep onto yet, and not itself a sweep failure worth auditing.
      return;
    }

    if (!this.hasWaitedLongEnoughSinceObserving(activeKeyId)) {
      return;
    }

    // Steady state: the last full count already confirmed nothing is pending for this exact key.
    // Re-check with the cheap, indexable probe rather than paying for another unconditional
    // full-table scan on a tick that, in the overwhelming common case, has nothing to do — see
    // `knownEmptyForKeyId`'s doc comment and `EncryptionKeysRepository.hasPendingReEncryption`.
    if (this.knownEmptyForKeyId === activeKeyId) {
      const hasPending = await this.repository.hasPendingReEncryption(
        this.dataSource.manager,
        activeKeyId,
      );

      if (!hasPending) {
        return;
      }
    }

    // Reaching here means there is reason to pay for the full count: either this key has not yet
    // been confirmed empty (a newly observed active key, or the previous full count found
    // pending rows), or the steady-state probe just found new work. The observable signal both
    // audit decisions below are derived from — see `lastObservedPendingCount`'s doc comment. Read
    // outside the claim's own transaction: this is a plain count, not a lock, and it must reflect
    // the true remaining total even when this tick's own claim comes back empty because a
    // concurrent replica currently holds every pending row's lock (`FOR UPDATE SKIP LOCKED`) — a
    // case where the claim's own result would otherwise be mistaken for "nothing left".
    const { pending } = await this.repository.countReEncryptionStatus(
      this.dataSource.manager,
      activeKeyId,
    );
    const previousPending = this.lastObservedPendingCount;
    this.lastObservedPendingCount = pending;

    if (pending === 0) {
      this.knownEmptyForKeyId = activeKeyId;

      if (previousPending !== undefined && previousPending > 0) {
        await this.recordCompletedOnce(activeKeyId);
      }
      return;
    }

    this.knownEmptyForKeyId = undefined;

    const isFirstObservedPendingForThisRotation = previousPending === 0;
    const batchSize = this.configService.getOrThrow<number>('ENCRYPTION_REENCRYPTION_BATCH_SIZE');

    const processedCount = await this.dataSource.transaction(async (manager) => {
      const ids = await this.repository.claimPendingReEncryptionIds(
        manager,
        activeKeyId,
        batchSize,
      );

      if (ids.length === 0) {
        return 0;
      }

      const onboardingRepository = manager.getRepository(OnboardingEntity);
      const onboardings = await onboardingRepository.find({ where: { id: In(ids) } });

      for (const onboarding of onboardings) {
        // `update`, not `save` — see the class doc comment. `save()` would diff the (unchanged)
        // decrypted value against a freshly reloaded copy and silently skip the write. `updatedAt`
        // is passed through unchanged too: `UpdateQueryBuilder.createUpdateExpression` (TypeORM
        // 0.3.25) stamps `@UpdateDateColumn` with `CURRENT_TIMESTAMP` only when it is *not*
        // already among the partial entity's own keys, so naming it here with its current value
        // is what keeps this write from touching it — `updated_at` is operator-facing (the admin
        // onboarding list), and a rotation must not make every row it sweeps read as just-updated.
        await onboardingRepository.update(onboarding.id, {
          context: onboarding.context,
          updatedAt: onboarding.updatedAt,
        });
      }

      return onboardings.length;
    });

    // No `processedCount > 0` gate: a tick that observes the 0-to-positive transition but claims
    // nothing this time (a peer already holds every pending row's lock via `FOR UPDATE SKIP
    // LOCKED`) must still record `started` — see "Cross-process audit bookkeeping" in the class
    // doc comment.
    if (isFirstObservedPendingForThisRotation) {
      await this.recordStartedOnce(activeKeyId, processedCount);
    }
  }

  private resolveActiveKeyIdOrNull(): string | null {
    try {
      return this.keyRing.activeKeyId();
    } catch (error) {
      if (error instanceof EncryptionKeyNotFoundError) {
        return null;
      }

      throw error;
    }
  }

  /**
   * See "Staleness across replicas" in the plan. Resets the clock whenever `activeKeyId` differs
   * from the one this process last observed — including the very first call, before which
   * `observedActiveKeyId` is `undefined` — and only allows a batch once strictly more than
   * `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS` has elapsed since that reset.
   */
  private hasWaitedLongEnoughSinceObserving(activeKeyId: string): boolean {
    const now = Date.now();

    if (this.observedActiveKeyId !== activeKeyId) {
      this.observedActiveKeyId = activeKeyId;
      this.observedActiveKeyAt = now;
      return false;
    }

    const refreshIntervalMs = this.configService.getOrThrow<number>(
      'ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS',
    );

    return now - (this.observedActiveKeyAt ?? now) > refreshIntervalMs;
  }

  /**
   * Whether the audit log already has a row for this exact action and key id — the cross-process,
   * durable source of truth `recordStartedOnce`/`recordCompletedOnce` check before writing, in
   * place of the per-process-only bookkeeping this service used before (see the class doc
   * comment). Queries `AuditLogEntity` directly, on the caller's own transaction manager, rather
   * than going through `AuditService.list`: this must run inside the same transaction as
   * `EncryptionKeysRepository.lockReEncryptionAudit` and the insert that may follow it, and a call
   * that opened its own transaction would not be serialized against whichever peer currently holds
   * that lock.
   */
  private async hasRecordedEncryptionEvent(
    manager: EntityManager,
    action: EncryptionAuditAction,
    keyId: string,
  ): Promise<boolean> {
    const count = await manager.getRepository(AuditLogEntity).count({
      where: { action, resourceType: ENCRYPTION_KEY_RESOURCE_TYPE, resourceId: keyId },
    });

    return count > 0;
  }

  /**
   * Records `encryption.reencryption_started` for `activeKeyId`, exactly once regardless of how
   * many processes are sweeping — see "Cross-process audit bookkeeping" in the class doc comment.
   * Takes `EncryptionKeysRepository.lockReEncryptionAudit` for the length of one transaction, so
   * the check-then-insert below can never race a peer performing the same check for the same key:
   * whichever process's transaction acquires the lock first gets an authoritative answer, and the
   * other blocks until it commits (and then finds the row already there).
   *
   * This is the one write in `src/encryption` that does not go through `AuditService.logEncryption`
   * — deliberately: that method always opens its own transaction, which would not share this one's
   * lock, so the check and the insert would no longer be atomic against each other. Best effort
   * only in every other sense; a failed attempt must never abandon a sweep it was reporting on.
   */
  private async recordStartedOnce(activeKeyId: string, rowsReEncrypted: number): Promise<void> {
    if (!this.auditService) {
      return;
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        await this.repository.lockReEncryptionAudit(
          manager,
          'encryption.reencryption_started',
          activeKeyId,
        );

        const alreadyStarted = await this.hasRecordedEncryptionEvent(
          manager,
          'encryption.reencryption_started',
          activeKeyId,
        );

        if (alreadyStarted) {
          return;
        }

        await this.auditRepository.insert(manager, {
          actorType: 'system',
          actorId: 'engine',
          action: 'encryption.reencryption_started',
          entryType: getAuditEntryType('encryption.reencryption_started'),
          resourceType: ENCRYPTION_KEY_RESOURCE_TYPE,
          resourceId: activeKeyId,
          metadata: { keyId: activeKeyId, rowsReEncrypted },
        });
      });
    } catch (error) {
      this.logger.warn(
        'Unable to record re-encryption-started audit event',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Records `encryption.reencryption_completed` for `activeKeyId`, exactly once, and only once a
   * `started` row already exists for it — never both unaudited *and* completed, which is what a
   * peer holding every pending row's lock (`FOR UPDATE SKIP LOCKED`) for an entire rotation used
   * to produce. Same lock-then-check shape as `recordStartedOnce`; see its doc comment for why
   * this bypasses `AuditService.logEncryption`.
   */
  private async recordCompletedOnce(activeKeyId: string): Promise<void> {
    if (!this.auditService) {
      return;
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        await this.repository.lockReEncryptionAudit(
          manager,
          'encryption.reencryption_completed',
          activeKeyId,
        );

        const hasStarted = await this.hasRecordedEncryptionEvent(
          manager,
          'encryption.reencryption_started',
          activeKeyId,
        );

        if (!hasStarted) {
          // No `started` was ever recorded for this rotation (a peer processed all of it while
          // holding every pending row's lock) — recording `completed` alone would be worse than
          // recording neither. See the class doc comment.
          return;
        }

        const alreadyCompleted = await this.hasRecordedEncryptionEvent(
          manager,
          'encryption.reencryption_completed',
          activeKeyId,
        );

        if (alreadyCompleted) {
          return;
        }

        await this.auditRepository.insert(manager, {
          actorType: 'system',
          actorId: 'engine',
          action: 'encryption.reencryption_completed',
          entryType: getAuditEntryType('encryption.reencryption_completed'),
          resourceType: ENCRYPTION_KEY_RESOURCE_TYPE,
          resourceId: activeKeyId,
          metadata: { keyId: activeKeyId },
        });
      });
    } catch (error) {
      this.logger.warn(
        'Unable to record re-encryption-completed audit event',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async recordSweepFailed(error: unknown): Promise<void> {
    if (!this.auditService) {
      return;
    }

    const activeKeyId = this.observedActiveKeyId ?? 'unknown';

    try {
      await this.auditService.logEncryption(this.dataSource, {
        action: 'encryption.reencryption_failed',
        actorType: 'system',
        actorId: 'engine',
        resourceId: activeKeyId,
        metadata: {
          keyId: activeKeyId,
          reason: error instanceof Error ? error.name : 'UnknownError',
        },
      });
    } catch (auditError) {
      this.logger.warn(
        'Unable to record re-encryption-failed audit event',
        auditError instanceof Error ? auditError.stack : undefined,
      );
    }
  }
}
