import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, Repository } from 'typeorm';
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
import { EncryptionKeysRepository, type SweepTarget } from './encryption-keys.repository';
import { EncryptionFailedError } from './errors/encryption-failed.error';
import { EncryptionKeyNotFoundError } from './errors/encryption-key-not-found.error';
import { EncryptionKeyUnwrapFailedError } from './errors/encryption-key-unwrap-failed.error';

/** The audit vocabulary one sweep direction writes. */
type SweepAuditActions = Readonly<{
  started: EncryptionAuditAction;
  completed: EncryptionAuditAction;
  failed: EncryptionAuditAction;
}>;

/** Moving rows onto the active key: turning encryption on, and every rotation after that. */
const REENCRYPTION_AUDIT: SweepAuditActions = {
  started: 'encryption.reencryption_started',
  completed: 'encryption.reencryption_completed',
  failed: 'encryption.reencryption_failed',
};

/** Moving rows back to plain JSON after encryption was turned off. */
const DECRYPTION_AUDIT: SweepAuditActions = {
  started: 'encryption.decryption_started',
  completed: 'encryption.decryption_completed',
  failed: 'encryption.decryption_failed',
};

/**
 * Filed against when encryption is off and no key was ever retired. Unreachable in practice —
 * a decrypt sweep only has work if some key once encrypted a row, and that key was retired to
 * get here — but the audit row needs a resource id even then.
 */
const UNKNOWN_KEY_RESOURCE = 'unknown';

/**
 * What one tick works toward, resolved from the ring at the start of the tick. `resourceId` is
 * the key the tick's audit rows are filed against — the active key while encryption is on, the
 * key most recently retired while it is off — and `key` identifies the target across ticks for
 * the in-memory bookkeeping below: a new key, or a switch between the two directions, is a new
 * episode with its own `started`/`completed` pair.
 */
type ResolvedTarget = Readonly<{
  key: string;
  target: SweepTarget;
  audit: SweepAuditActions;
  resourceId: string;
}>;

/** A stored value this process cannot read: not a database failure, a property of that one row. */
const isUnreadableStoredValue = (error: unknown): error is Error =>
  error instanceof EncryptionFailedError ||
  error instanceof EncryptionKeyNotFoundError ||
  error instanceof EncryptionKeyUnwrapFailedError;

/**
 * The background sweep that moves every `onboardings.context` row toward the state the operator
 * chose: onto the active key after encryption is turned on or a key is added, back to plain JSON
 * after it is turned off. Same poller shape as `RetryService` (`src/webhook/retry.service.ts`) —
 * skipped in `MODE=api-only`, one immediate poll then `setInterval`, every tick wrapped so a
 * failure is logged and audited but never kills the timer, `onModuleDestroy` clearing the timer
 * and awaiting the in-flight poll — but batched SQL rather than a queue.
 *
 * Each tick resolves its target from the ring, claims up to `ENCRYPTION_SWEEP_BATCH_SIZE` rows
 * not yet there (`EncryptionKeysRepository.claimPendingSweepIds`, `FOR UPDATE SKIP LOCKED`),
 * loads each one through `OnboardingEntity` and writes it straight back with
 * `Repository.update(id, { context, updatedAt })` — never raw SQL — so the column transformer
 * does the actual work: decrypting under whichever key the row names, then encrypting under the
 * active key or, with none active, storing plain JSON. It must be `update`, not `save`: `save()`
 * diffs the new value against a freshly reloaded copy (`SubjectChangedColumnsComputer`, TypeORM
 * 0.3.25), compares the two *decrypted* values, finds them equal — the plaintext never changes,
 * only its stored form — and silently issues no `UPDATE` at all, whereas `update()` runs the
 * transformer unconditionally for every property named. `updatedAt` is named with its current
 * value so `UpdateQueryBuilder` does not stamp `CURRENT_TIMESTAMP` over it: the column is
 * operator-facing, and a sweep must not make every row read as just-updated.
 *
 * Idempotent by construction: the claim's predicate is "not yet in the target state", so a row
 * already there — moved by this tick, by a peer, or written fresh after the change — is never
 * selected again, and a second change made mid-sweep only moves the target.
 *
 * ### Rows this process cannot move
 *
 * A stored value that fails to decrypt — tampered ciphertext, or a key that stopped resolving
 * between the claim and the load — is a property of that one row, not of the tick. It is skipped,
 * remembered in `unmovableOnboardingIds` so no later claim selects it again, audited once as
 * `*_failed` naming the row, and left for a peer or a restart to retry; the rest of the batch
 * proceeds. Without this, one such row would head every batch forever and stall the whole sweep.
 * The claim also only ever selects rows on keys the ring can actually read
 * (`SweepTarget.sourceKeyIds`), so an envelope naming a key this process does not hold is never
 * claimed in the first place. `countSweepStatus` still counts every such row as pending, so the
 * operator-facing progress stays honest about work the sweep cannot finish.
 *
 * ### Staleness across replicas
 *
 * `engine` and `engine-worker` run as separate containers (`docker-compose.yml`), so the process
 * running this sweep is never guaranteed to be the one serving reads. Every change to the ring
 * already takes effect one `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS` after it is made (see
 * `EncryptionAdminService`), and the sweep additionally waits longer than that interval after
 * first observing a target before moving anything toward it, so no row is ever rewritten under a
 * key a reading process has not yet had the chance to load.
 *
 * ### Cross-process audit bookkeeping
 *
 * More than one replica can run this sweep at once, so `started`/`completed` cannot be decided
 * from per-process memory alone. `lastObservedPendingCount` and `idleForTargetKey` decide *when*
 * this process bothers to check — a steady-state tick costs one indexed probe, and a process that
 * starts up mid-sweep does not credit itself with a `started` it did not see begin — but not
 * whether the row is written. That is derived from the audit log, the one piece of state every
 * replica shares: `recordStartedOnce`/`recordCompletedOnce` take
 * `EncryptionKeysRepository.lockSweepAudit` for the length of one transaction, check whether the
 * row already exists, and insert it only if not, so two replicas racing to record the same step
 * can never both observe "not yet recorded". `completed` is additionally refused unless a
 * `started` exists for the same target, so a sweep a peer ran in its entirety never ends up
 * "completed" with no "started".
 */
@Injectable()
export class EncryptionSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EncryptionSweepService.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isShuttingDown = false;
  private activePollPromise: Promise<void> | null = null;

  /** The target this process most recently observed, and when it first saw it — the start delay's clock. */
  private observedTargetKey: string | undefined;
  private observedTargetAt: number | undefined;
  /** The target the last tick worked toward; what a failed tick is audited against. */
  private lastResolvedTarget: ResolvedTarget | undefined;

  /**
   * The pending count this process observed on its previous tick for the currently observed
   * target. `undefined` immediately after a restart, before this process has taken its own
   * reading — deliberately, so a process that starts up mid-sweep does not attempt to record
   * `*_started` for a change it did not itself see begin. Reset to `0` when the target changes
   * under a running process, so the next positive count *is* the start of the new episode: a
   * rotation or a switch of direction made while a previous sweep was still under way gets its own
   * `started`. This only decides *when* this process attempts the write, never whether it lands —
   * see "Cross-process audit bookkeeping" above.
   */
  private lastObservedPendingCount: number | undefined;

  /**
   * The target this process last found nothing it could claim for — the sweep is caught up, or
   * every remaining row is held by a peer or on `unmovableOnboardingIds`. While this equals the
   * current target, `sweepOnce` re-checks with `hasPendingSweep` — an indexed probe that stops at
   * the first match, or at an empty index — instead of `countSweepStatus`'s full-table count,
   * which would otherwise run on every tick forever once a sweep has finished. Cleared the moment
   * a claim returns rows or the target changes.
   */
  private idleForTargetKey: string | undefined;

  /**
   * Onboarding ids this process could not move and has audited once; excluded from every later
   * probe and claim so one such row never blocks the rest. Per process and never persisted: a
   * restart retries them, which is right, since the usual cause — a key-encryption key that
   * changed — is fixed by a restart with the right one.
   */
  private readonly unmovableOnboardingIds = new Set<string>();

  constructor(
    private readonly repository: EncryptionKeysRepository,
    private readonly keyRing: EncryptionKeyRingService,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly auditRepository: AuditRepository,
    private readonly auditService: AuditService,
  ) {}

  onModuleInit(): void {
    // Without the key-encryption key this process can neither encrypt nor decrypt a row, so there
    // is nothing it could ever move; the ring already refused to boot if the table had keys.
    if (!this.keyRing.isKeyEncryptionKeyConfigured()) {
      return;
    }

    const mode = this.configService.getOrThrow<AppMode>('MODE');

    if (mode === AppMode.API_ONLY) {
      return;
    }

    const pollIntervalMs = this.configService.getOrThrow<number>(
      'ENCRYPTION_SWEEP_POLL_INTERVAL_MS',
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
      this.logger.error(`ENCRYPTION_SWEEP_FAILED reason=${reason}`);
      await this.recordSweepFailed(error);
    } finally {
      this.isRunning = false;
    }
  }

  private async sweepOnce(): Promise<void> {
    const resolved = this.resolveTarget();
    this.lastResolvedTarget = resolved;

    if (!this.hasWaitedLongEnoughSinceObserving(resolved.key)) {
      return;
    }

    const excluded = [...this.unmovableOnboardingIds];

    // Steady state: the last claim for this target found nothing this process could move. Ask the
    // indexes whether that is still so before paying for the full count — see `idleForTargetKey`.
    if (this.idleForTargetKey === resolved.key) {
      const hasPending = await this.repository.hasPendingSweep(
        this.dataSource.manager,
        resolved.target,
        excluded,
      );

      if (!hasPending) {
        return;
      }
    }

    // The observable signal both audit decisions are derived from. Read outside the claim's own
    // transaction: this is a plain count, not a lock, and it must reflect the true remaining total
    // even when this tick's claim comes back empty because a peer holds every pending row's lock.
    const { pending } = await this.repository.countSweepStatus(
      this.dataSource.manager,
      resolved.target.activeKeyId,
    );
    const previousPending = this.lastObservedPendingCount;
    this.lastObservedPendingCount = pending;

    if (pending === 0) {
      this.idleForTargetKey = resolved.key;

      if (previousPending !== undefined && previousPending > 0) {
        await this.recordCompletedOnce(resolved);
      }

      return;
    }

    const isFirstObservedPendingForThisTarget = previousPending === 0;
    const batchSize = this.configService.getOrThrow<number>('ENCRYPTION_SWEEP_BATCH_SIZE');

    const { claimed, moved } = await this.dataSource.transaction(async (manager) => {
      const ids = await this.repository.claimPendingSweepIds(
        manager,
        resolved.target,
        batchSize,
        excluded,
      );
      const onboardingRepository = manager.getRepository(OnboardingEntity);
      let movedCount = 0;

      for (const id of ids) {
        if (await this.moveOnboarding(onboardingRepository, id, resolved)) {
          movedCount += 1;
        }
      }

      return { claimed: ids.length, moved: movedCount };
    });

    // Nothing this process can move right now — every pending row is locked by a peer or on its
    // own unmovable list — so later ticks probe cheaply until the indexes report a change.
    this.idleForTargetKey = claimed === 0 ? resolved.key : undefined;

    // No `moved > 0` gate: a tick that observes the 0-to-positive transition but claims nothing
    // this time must still record `started` — see "Cross-process audit bookkeeping".
    if (isFirstObservedPendingForThisTarget) {
      await this.recordStartedOnce(resolved, moved);
    }
  }

  /**
   * Loads one claimed row through the entity — so the column transformer decrypts it — and writes
   * it straight back with `update`, so the transformer re-encrypts it under the active key or,
   * with none, stores plain JSON. `false` for a row whose stored value this process cannot read:
   * remembered, audited once, and left for a peer or a restart (see the class doc comment). Any
   * other failure is not a property of one row and propagates, failing the tick as a whole.
   */
  private async moveOnboarding(
    onboardingRepository: Repository<OnboardingEntity>,
    id: string,
    resolved: ResolvedTarget,
  ): Promise<boolean> {
    try {
      // The claim holds this row's lock for the transaction, so it is there to be found.
      const onboarding = await onboardingRepository.findOneByOrFail({ id });

      await onboardingRepository.update(onboarding.id, {
        context: onboarding.context,
        updatedAt: onboarding.updatedAt,
      });

      return true;
    } catch (error) {
      if (!isUnreadableStoredValue(error)) {
        throw error;
      }

      this.unmovableOnboardingIds.add(id);
      this.logger.warn(`ENCRYPTION_SWEEP_ROW_UNREADABLE onboardingId=${id} reason=${error.name}`);
      await this.recordRowFailed(resolved, id, error);

      return false;
    }
  }

  private resolveTarget(): ResolvedTarget {
    const activeKeyId = this.keyRing.activeKeyId();
    const sourceKeyIds = this.keyRing.resolvableKeyIds().filter((id) => id !== activeKeyId);

    if (activeKeyId !== null) {
      return {
        key: activeKeyId,
        target: { activeKeyId, sourceKeyIds },
        audit: REENCRYPTION_AUDIT,
        resourceId: activeKeyId,
      };
    }

    const retiredKeyId = this.keyRing.latestDeactivatedKeyId() ?? UNKNOWN_KEY_RESOURCE;

    return {
      key: `plaintext:${retiredKeyId}`,
      target: { activeKeyId: null, sourceKeyIds },
      audit: DECRYPTION_AUDIT,
      resourceId: retiredKeyId,
    };
  }

  /**
   * See "Staleness across replicas" in the class doc comment. Resets the clock whenever the target
   * differs from the one this process last observed — including the very first call — and only
   * allows a batch once strictly more than `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS` has elapsed
   * since that reset. A change of target also opens a new audit episode: the pending baseline
   * becomes `0` so the next positive count records `started`, except on the very first
   * observation after boot, which keeps `undefined` (see `lastObservedPendingCount`).
   */
  private hasWaitedLongEnoughSinceObserving(targetKey: string): boolean {
    const now = Date.now();

    if (this.observedTargetKey !== targetKey) {
      this.lastObservedPendingCount = this.observedTargetKey === undefined ? undefined : 0;
      this.idleForTargetKey = undefined;
      this.observedTargetKey = targetKey;
      this.observedTargetAt = now;

      return false;
    }

    const refreshIntervalMs = this.configService.getOrThrow<number>(
      'ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS',
    );

    return now - (this.observedTargetAt ?? now) > refreshIntervalMs;
  }

  /**
   * Whether the audit log already has a row for this exact action and resource — the
   * cross-process, durable source of truth `recordStartedOnce`/`recordCompletedOnce` check before
   * writing. Queries `AuditLogEntity` directly, on the caller's own transaction manager, rather
   * than through `AuditService.list`: this must run inside the same transaction as
   * `EncryptionKeysRepository.lockSweepAudit` and the insert that may follow it, and a call that
   * opened its own transaction would not be serialized against whichever peer holds that lock.
   */
  private async hasRecordedEncryptionEvent(
    manager: EntityManager,
    action: EncryptionAuditAction,
    resourceId: string,
  ): Promise<boolean> {
    const count = await manager.getRepository(AuditLogEntity).count({
      where: { action, resourceType: ENCRYPTION_KEY_RESOURCE_TYPE, resourceId },
    });

    return count > 0;
  }

  /**
   * Records this target's `started` exactly once regardless of how many processes are sweeping —
   * see "Cross-process audit bookkeeping". The one write in `src/encryption` that does not go
   * through `AuditService.logEncryption`, deliberately: that method always opens its own
   * transaction, which would not share this one's advisory lock, so the check and the insert
   * would no longer be atomic against each other. Best effort in every other sense; a failed
   * attempt must never abandon a sweep it was reporting on.
   */
  private async recordStartedOnce(resolved: ResolvedTarget, rowsMoved: number): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.repository.lockSweepAudit(manager, resolved.audit.started, resolved.resourceId);

        if (
          await this.hasRecordedEncryptionEvent(
            manager,
            resolved.audit.started,
            resolved.resourceId,
          )
        ) {
          return;
        }

        await this.auditRepository.insert(manager, {
          actorType: 'system',
          actorId: 'engine',
          action: resolved.audit.started,
          entryType: getAuditEntryType(resolved.audit.started),
          resourceType: ENCRYPTION_KEY_RESOURCE_TYPE,
          resourceId: resolved.resourceId,
          metadata: { keyId: resolved.resourceId, rowsMoved },
        });
      });
    } catch (error) {
      this.logger.warn(
        `Unable to record ${resolved.audit.started} audit event`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Records this target's `completed` exactly once, and only once a `started` exists for it —
   * never both unaudited *and* completed. Same lock-then-check shape as `recordStartedOnce`.
   */
  private async recordCompletedOnce(resolved: ResolvedTarget): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.repository.lockSweepAudit(
          manager,
          resolved.audit.completed,
          resolved.resourceId,
        );

        const hasStarted = await this.hasRecordedEncryptionEvent(
          manager,
          resolved.audit.started,
          resolved.resourceId,
        );

        if (!hasStarted) {
          // No `started` was ever recorded for this episode — a peer processed all of it while
          // holding every pending row's lock — and `completed` alone would be worse than neither.
          return;
        }

        if (
          await this.hasRecordedEncryptionEvent(
            manager,
            resolved.audit.completed,
            resolved.resourceId,
          )
        ) {
          return;
        }

        await this.auditRepository.insert(manager, {
          actorType: 'system',
          actorId: 'engine',
          action: resolved.audit.completed,
          entryType: getAuditEntryType(resolved.audit.completed),
          resourceType: ENCRYPTION_KEY_RESOURCE_TYPE,
          resourceId: resolved.resourceId,
          metadata: { keyId: resolved.resourceId },
        });
      });
    } catch (error) {
      this.logger.warn(
        `Unable to record ${resolved.audit.completed} audit event`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** One row per unreadable onboarding, per process lifetime — the skip set is what dedupes it. */
  private async recordRowFailed(
    resolved: ResolvedTarget,
    onboardingId: string,
    error: Error,
  ): Promise<void> {
    try {
      await this.auditService.logEncryption(this.dataSource, {
        action: resolved.audit.failed,
        actorType: 'system',
        actorId: 'engine',
        resourceId: resolved.resourceId,
        metadata: { keyId: resolved.resourceId, onboardingId, reason: error.name },
      });
    } catch (auditError) {
      this.logger.warn(
        `Unable to record ${resolved.audit.failed} audit event`,
        auditError instanceof Error ? auditError.stack : undefined,
      );
    }
  }

  /** A tick that failed as a whole — a database error, never a single unreadable row. */
  private async recordSweepFailed(error: unknown): Promise<void> {
    const audit = this.lastResolvedTarget?.audit ?? REENCRYPTION_AUDIT;
    const resourceId = this.lastResolvedTarget?.resourceId ?? UNKNOWN_KEY_RESOURCE;

    try {
      await this.auditService.logEncryption(this.dataSource, {
        action: audit.failed,
        actorType: 'system',
        actorId: 'engine',
        resourceId,
        metadata: {
          keyId: resourceId,
          reason: error instanceof Error ? error.name : 'UnknownError',
        },
      });
    } catch (auditError) {
      this.logger.warn(
        `Unable to record ${audit.failed} audit event`,
        auditError instanceof Error ? auditError.stack : undefined,
      );
    }
  }
}
