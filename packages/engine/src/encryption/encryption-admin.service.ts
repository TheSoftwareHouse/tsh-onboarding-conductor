import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  ADMIN_ACCESS_UNKNOWN_ACTOR,
  type EncryptionAuditActorType,
  type EncryptionAuditInput,
} from '../audit/audit.types';
import { AuditService } from '../audit/audit.service';
import { AppConfig } from '../config/app.config';
import { isKeyActive, isKeyPendingActivation } from './encryption-key-activation';
import {
  DEFAULT_ENCRYPTION_KEY_ROTATION_INTERVAL,
  isRotationDue,
  resolveNextRotationAt,
  type EncryptionKeyRotationInterval,
} from './encryption-key-rotation';
import { EncryptionKeyRingService } from './encryption-key-ring.service';
import {
  EncryptionKeysRepository,
  isActiveKeyConflict,
  type NewEncryptionKey,
} from './encryption-keys.repository';
import type { EncryptionKeyEntity } from './entity/encryption-key.entity';
import { EncryptionDisabledException } from './errors/encryption-disabled.exception';
import { EncryptionKeyNotConfiguredException } from './errors/encryption-key-not-configured.exception';
import { EncryptionKeyRingConflictException } from './errors/encryption-key-ring-conflict.exception';

/** One row of `encryption_keys`, as the admin surface reports it — never its wrapped material. */
export type EncryptionKeyView = Readonly<{
  id: string;
  createdAt: Date;
  createdBy: string | null;
  activatedAt: Date;
  deletedAt: Date | null;
  /** `true` for the single key `encrypt` currently uses — see `isKeyActive`. */
  active: boolean;
  /**
   * `true` for a key that has been added and is not superseded, but whose `activatedAt` has not
   * arrived yet — the grace window every change opens so every replica has a chance to learn of
   * it before anything encrypts with it. Never `true` for more than one row at a time.
   */
  pendingActivation: boolean;
}>;

/**
 * The automatic-rotation schedule, as the admin surface reports it: the interval the active key
 * carries and the instant it next falls due. Both `null` while encryption is off, and `interval`
 * is `null` whenever an operator has turned automatic rotation off.
 */
export type EncryptionRotationView = Readonly<{
  interval: EncryptionKeyRotationInterval | null;
  nextRotationAt: Date | null;
}>;

export type SweepProgressView = Readonly<{
  /** Onboardings not yet in the state the operator chose; see `EncryptionKeysRepository.countSweepStatus`. */
  pending: number;
  /** Every onboarding. */
  total: number;
}>;

export type EncryptionStateView = Readonly<{
  /**
   * The state the operator chose: `true` while a key row has not been retired, even during the
   * grace window before it activates. What the sweep converges every row toward.
   */
  enabled: boolean;
  /** Whether this process holds the key-encryption key; without it, nothing below can change. */
  keyConfigured: boolean;
  keys: readonly EncryptionKeyView[];
  rotation: EncryptionRotationView;
  progress: SweepProgressView;
}>;

/**
 * Who a rotation is recorded against: the operator who asked for it, or the engine itself acting
 * on the schedule the operator set. The two write the same `key_added`/`key_superseded` pair —
 * a rotation is a rotation — and this is what tells them apart in the trail.
 */
type RotationActor = Readonly<{ actorType: EncryptionAuditActorType; actorId: string }>;

/** What `EncryptionKeyRotationService`'s own rotations are filed under. */
const SCHEDULED_ROTATION_ACTOR: RotationActor = { actorType: 'system', actorId: 'engine' };

/**
 * The admin read/write surface behind `/v1/admin/encryption`: `getState`, `setEnabled`,
 * `setRotationInterval` and `addKey`, plus `rotateIfDue` for the engine's own scheduler. Mirrors
 * `ConnectorSettingsAdminService`'s split from persistence — `EncryptionKeysRepository` moves
 * rows, this service orchestrates and writes the audit rows every change of its own produces
 * (`enabled`, `disabled`, `rotation_schedule_changed`, `key_added`, `key_superseded`); the sweep
 * writes its own.
 *
 * Every change to `encryption_keys` after the table was created goes through here. "Encryption
 * is on" means a row with `deleted_at IS NULL` exists — turning it on inserts one, turning it off
 * soft-deletes it, rotating does both in one transaction — so the state is derived from the same
 * rows the ring loads rather than stored a second time. Each change reloads the local ring so
 * this process's own view is immediately current, then audits after the transaction has
 * committed, so a failed audit write can never roll back a change already made durable. The
 * reload is best effort — logged, never thrown: the periodic refresh and the grace window below
 * make the change correct without it, and a transient failure there must not turn a committed
 * change into a failed request whose retry, being idempotent, would never write the audit row.
 * A rotation's own two audit rows are best effort for a sharper version of that reason — it is
 * the one change here that is *not* idempotent, so a `500` over a missed audit row would invite a
 * retry that rotates a second time; see `auditRotationStep`.
 *
 * ### At most one active key, including during a change
 *
 * Reloading the ring immediately after a commit would let this process act on the change at once
 * — but a peer replica only learns of it after its own next periodic reload, up to
 * `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS` later. A row written in that window under a key the
 * peer has not loaded, and read on the peer first, would throw `EncryptionKeyNotFoundError`.
 * Every change here therefore takes effect one refresh interval in the *future*: an incoming
 * key's `activatedAt`, and an outgoing key's `deletedAt`, are set to `now + refreshIntervalMs`
 * rather than `now`. `isKeyActive` (`encryption-key-activation.ts`) admits a row only once its
 * `activatedAt` has arrived and only until its `deletedAt` arrives, so until that instant every
 * ring — including this process's freshly reloaded one — keeps resolving the previous state, and
 * every peer has a full interval to learn the new row exists before any write depends on it. On
 * a rotation the two flip together, so there is never an instant with two active keys; turning
 * encryption off leaves none. The database invariant `uq_encryption_keys_active` governs
 * `deleted_at IS NULL` — still at most one row at a time — with this time-based one on top. A
 * second change issued before the first's window elapses composes without a special case: it
 * always acts on whichever row currently holds `deleted_at IS NULL`, so the chain of windows
 * simply extends rather than overlapping or leaving a gap.
 *
 * A key's material is never removed once it stops being active — `EncryptionKeysRepository`
 * never deletes a row, only marks it — so `keyFor` keeps resolving it for as long as any row may
 * still name it, which is what lets the sweep decrypt rows after encryption is turned off.
 *
 * ### Automatic rotation
 *
 * The same active row carries how often the engine should rotate it on its own
 * (`rotation_interval`, migration `0026`), so "encryption is on" and "this is when it next
 * rotates" remain one piece of state rather than two that can disagree. `rotateIfDue` — called
 * by `EncryptionKeyRotationService`, never by a route — replaces the key through the identical
 * path an operator's `addKey` takes, under the advisory lock `lockKeyRotation` provides so
 * concurrent replicas cannot each rotate the same due key. Because the new row carries both the
 * inherited interval and its own `created_at`, and the next rotation is measured from that
 * (`encryption-key-rotation.ts`), every rotation — scheduled or manual — restarts the countdown
 * with nothing to reset explicitly.
 */
@Injectable()
export class EncryptionAdminService {
  private readonly logger = new Logger(EncryptionAdminService.name);

  constructor(
    private readonly repository: EncryptionKeysRepository,
    private readonly ring: EncryptionKeyRingService,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /**
   * The chosen state, whether this process could change it, the full key history (most recent
   * first) and the sweep's progress toward that state. Progress is counted against the chosen
   * state, not against what the ring has activated yet, so an operator sees the work a change
   * implies as soon as the change is made.
   */
  async getState(): Promise<EncryptionStateView> {
    const manager = this.dataSource.manager;
    const rows = await this.repository.findAll(manager);
    const now = new Date();
    const targetKey = rows.find((row) => row.deletedAt === null) ?? null;
    const progress = await this.repository.countSweepStatus(manager, targetKey?.id ?? null);

    return {
      enabled: targetKey !== null,
      keyConfigured: this.ring.isKeyEncryptionKeyConfigured(),
      keys: rows.map((row) => this.toView(row, now)),
      rotation: {
        interval: targetKey?.rotationInterval ?? null,
        nextRotationAt: resolveNextRotationAt(targetKey),
      },
      progress,
    };
  }

  /**
   * Turns encryption on — generating, wrapping and storing a first (or fresh) key — or off,
   * retiring the active one. Idempotent: asking for the state that already holds changes nothing
   * and audits nothing. Turning on needs the key-encryption key to wrap with; turning off does
   * not, since it only marks a row. Returns the resulting state, as `getState` would.
   */
  async setEnabled(enabled: boolean, actorId: string): Promise<EncryptionStateView> {
    const resolvedActorId = actorId === '' ? ADMIN_ACCESS_UNKNOWN_ACTOR : actorId;

    if (enabled) {
      await this.enable(resolvedActorId);
    } else {
      await this.disable(resolvedActorId);
    }

    return this.getState();
  }

  /**
   * Chooses how often the engine rotates the active key on its own, or `null` to stop rotating it
   * automatically. Refuses while encryption is off: the schedule lives on the active key, so
   * there is nothing to write it to. Idempotent — choosing the interval already in force changes
   * nothing and audits nothing. The countdown is not restarted here: it is always the active
   * key's own age against the interval (`resolveNextRotationAt`), so shortening the interval past
   * that age makes the next scheduled tick rotate. Returns the resulting state, as `getState`
   * would.
   */
  async setRotationInterval(
    rotationInterval: EncryptionKeyRotationInterval | null,
    actorId: string,
  ): Promise<EncryptionStateView> {
    const resolvedActorId = actorId === '' ? ADMIN_ACCESS_UNKNOWN_ACTOR : actorId;
    const active = await this.repository.findActive(this.dataSource.manager);

    if (active === null) {
      throw new EncryptionDisabledException();
    }

    // Read off the row above, which a rotation may already have superseded by the time the write
    // below runs. That is safe to decide from: a rotation carries the outgoing key's interval
    // forward unchanged, so the incoming key answers this comparison the same way.
    if (active.rotationInterval === rotationInterval) {
      return this.getState();
    }

    // The id the `UPDATE` itself wrote, never `active.id`: between the read above and this write a
    // rotation may have moved `deleted_at IS NULL` onto a new key, and the audit row has to name
    // the key that actually carries the schedule now.
    const scheduledKeyId = await this.repository.updateRotationInterval(
      this.dataSource.manager,
      rotationInterval,
    );

    // No row means a concurrent request turned encryption off between the read above and this
    // write; there is no longer a key to schedule, which is the same refusal as finding none.
    if (scheduledKeyId === null) {
      throw new EncryptionDisabledException();
    }

    await this.auditService.logEncryption(this.dataSource, {
      action: 'encryption.rotation_schedule_changed',
      actorType: 'operator',
      actorId: resolvedActorId,
      resourceId: scheduledKeyId,
      metadata: { keyId: scheduledKeyId, rotationInterval },
    });

    return this.getState();
  }

  /**
   * Generates and wraps a new key, replaces the active row with it, reloads the ring, and audits
   * both halves of the rotation. Refuses with a named 4xx rather than a 500 when encryption is
   * off — there is no active key to supersede — or when this process holds no key-encryption key.
   */
  async addKey(actorId: string): Promise<{ id: string }> {
    this.assertKeyConfigured();

    const resolvedActorId = actorId === '' ? ADMIN_ACCESS_UNKNOWN_ACTOR : actorId;
    const rotated = await this.rotate(
      { actorType: 'operator', actorId: resolvedActorId },
      { onlyWhenDue: false },
    );

    // `rotate` reports "nothing to replace" as `null`; asked for explicitly rather than by a
    // schedule, that is the operator-facing refusal — encryption is off.
    if (rotated === null) {
      throw new EncryptionDisabledException();
    }

    return rotated;
  }

  /**
   * Rotates the key if the schedule on it has come due, and does nothing otherwise — the one
   * write `EncryptionKeyRotationService` makes, on every replica running it, once a minute by
   * default. Returns the new key, or `null` when there was nothing to do: no key, no schedule,
   * not due yet, or a peer that rotated it first. Serialized across replicas by
   * `EncryptionKeysRepository.lockKeyRotation`, and audited as `system` rather than `operator`.
   */
  async rotateIfDue(): Promise<{ id: string } | null> {
    this.assertKeyConfigured();

    return this.rotate(SCHEDULED_ROTATION_ACTOR, { onlyWhenDue: true });
  }

  private async enable(actorId: string): Promise<void> {
    this.assertKeyConfigured();

    const { id, wrappedKey } = this.ring.generateWrappedKey();
    const inserted = await this.insertFirstKey({
      id,
      wrappedKey,
      createdBy: actorId,
      activatedAt: this.graceThreshold(),
      // Turning encryption on starts rotating it too: a deployment that never opens this page
      // again still gets a fresh key every week, and the operator can widen, narrow or stop that
      // from the same page.
      rotationInterval: DEFAULT_ENCRYPTION_KEY_ROTATION_INTERVAL,
    });

    if (!inserted) {
      return;
    }

    await this.reloadRing();
    await this.auditService.logEncryption(this.dataSource, {
      action: 'encryption.enabled',
      actorType: 'operator',
      actorId,
      resourceId: id,
      metadata: { keyId: id },
    });
  }

  private async disable(actorId: string): Promise<void> {
    const retiredKeyId = await this.dataSource.transaction(async (manager) => {
      const active = await this.repository.findActive(manager);

      if (active === null) {
        return null;
      }

      // Zero rows marked means a concurrent request retired the key between this transaction's
      // read and its write; that request audits the change, this one has nothing to report.
      const retired = await this.repository.softDeleteActive(manager, this.graceThreshold());

      return retired === 0 ? null : active.id;
    });

    if (retiredKeyId === null) {
      return;
    }

    await this.reloadRing();
    await this.auditService.logEncryption(this.dataSource, {
      action: 'encryption.disabled',
      actorType: 'operator',
      actorId,
      resourceId: retiredKeyId,
      metadata: { keyId: retiredKeyId },
    });
  }

  /**
   * Stores `key` as the one `deleted_at IS NULL` row, or does nothing when one already exists
   * (encryption is already on, or about to be). Returns whether it inserted. Two operators
   * turning encryption on at the same instant both see no active row; the loser's insert collides
   * with `uq_encryption_keys_active`, which is the same outcome as finding the winner's row first —
   * encryption is on, exactly as asked — so it is reported as "already on", not as a conflict.
   */
  private async insertFirstKey(key: NewEncryptionKey): Promise<boolean> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const active = await this.repository.findActive(manager);

        if (active !== null) {
          return false;
        }

        await this.repository.insert(manager, key);

        return true;
      });
    } catch (error) {
      if (isActiveKeyConflict(error)) {
        return false;
      }

      throw error;
    }
  }

  /**
   * The one path a key is replaced by, whether an operator asked for it or the schedule came due:
   * write the rotation, reload this process's ring, then audit both halves of it against whoever
   * caused it. `null` when there was nothing to replace — see `replaceActiveKey`. Both audit rows
   * are best effort; see `auditRotationStep` for why this path in particular cannot fail its
   * request over one.
   */
  private async rotate(
    actor: RotationActor,
    options: { onlyWhenDue: boolean },
  ): Promise<{ id: string } | null> {
    const rotated = await this.replaceActiveKey(actor, options.onlyWhenDue);

    if (rotated === null) {
      return null;
    }

    await this.reloadRing();

    await this.auditRotationStep({
      action: 'encryption.key_added',
      actorType: actor.actorType,
      actorId: actor.actorId,
      resourceId: rotated.id,
      metadata: { keyId: rotated.id },
    });
    await this.auditRotationStep({
      action: 'encryption.key_superseded',
      actorType: actor.actorType,
      actorId: actor.actorId,
      resourceId: rotated.supersededKeyId,
      metadata: { keyId: rotated.id, supersededKeyId: rotated.supersededKeyId },
    });

    return { id: rotated.id };
  }

  /**
   * One half of a rotation's audit trail, written after the rotation has committed and logged
   * rather than thrown — the same treatment `reloadRing` gets, for a sharper reason. Turning
   * encryption on or off is idempotent, so answering a committed change with a `500` costs at
   * worst a missing audit row when the operator retries. A rotation is not: `POST /keys` replaces
   * the active key every time it is called, so reporting a committed rotation as failed invites a
   * retry that rotates a *second* time — another key, and another full re-encryption sweep of
   * every onboarding. The two halves are passed here separately so a failure to record one still
   * leaves the other recorded.
   */
  private async auditRotationStep(input: EncryptionAuditInput): Promise<void> {
    try {
      await this.auditService.logEncryption(this.dataSource, input);
    } catch (error) {
      this.logger.warn(
        `Unable to record the ${input.action} audit row for encryption key ` +
          `"${input.resourceId}"; the rotation itself is committed and the key ring already ` +
          'holds it',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Soft-deletes the current `deleted_at IS NULL` row and inserts a freshly wrapped key in its
   * place, in one transaction, so the partial unique index never sees two such rows and a failure
   * leaves the previous one in place. The incoming key inherits the schedule the row it replaces
   * carried; its own `created_at` is what restarts the countdown.
   *
   * `null` means there was nothing to replace: encryption is off, a concurrent request turned it
   * off between this transaction's read and its write (`softDeleteActive` then marks nothing), or
   * — under `onlyWhenDue` — the schedule has not come due, which is the ordinary outcome of
   * nearly every scheduled tick. `onlyWhenDue` additionally takes `lockKeyRotation` first, so a
   * replica arriving second reads the key the first one just created and finds it not due, and it
   * maps the unique-violation race against an operator's simultaneous rotation to that same
   * `null` — the key was rotated, which is all the schedule wanted. An operator's own rotation
   * instead surfaces that race as a named 409, as it always has.
   */
  private async replaceActiveKey(
    actor: RotationActor,
    onlyWhenDue: boolean,
  ): Promise<{ id: string; supersededKeyId: string } | null> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        if (onlyWhenDue) {
          await this.repository.lockKeyRotation(manager);
        }

        const active = await this.repository.findActive(manager);

        if (active === null || (onlyWhenDue && !isRotationDue(active, new Date()))) {
          return null;
        }

        const activatedAt = this.graceThreshold();
        const superseded = await this.repository.softDeleteActive(manager, activatedAt);

        if (superseded === 0) {
          return null;
        }

        const { id, wrappedKey } = this.ring.generateWrappedKey();

        await this.repository.insert(manager, {
          id,
          wrappedKey,
          createdBy: actor.actorId,
          activatedAt,
          rotationInterval: active.rotationInterval,
        });

        return { id, supersededKeyId: active.id };
      });
    } catch (error) {
      if (isActiveKeyConflict(error)) {
        if (onlyWhenDue) {
          return null;
        }

        throw new EncryptionKeyRingConflictException();
      }

      throw error;
    }
  }

  /** See the class doc comment: the change is already durable, so a failed reload is logged, never thrown. */
  private async reloadRing(): Promise<void> {
    try {
      await this.ring.reload();
    } catch (error) {
      this.logger.warn(
        'Unable to reload the encryption key ring after a change to encryption_keys; the ' +
          'periodic refresh will pick the change up',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private assertKeyConfigured(): void {
    if (!this.ring.isKeyEncryptionKeyConfigured()) {
      throw new EncryptionKeyNotConfiguredException();
    }
  }

  /** The instant a change made now takes effect — see "At most one active key" above. */
  private graceThreshold(): Date {
    const refreshIntervalMs = this.configService.getOrThrow<number>(
      'ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS',
    );

    return new Date(Date.now() + refreshIntervalMs);
  }

  private toView(row: EncryptionKeyEntity, now: Date): EncryptionKeyView {
    return {
      id: row.id,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      activatedAt: row.activatedAt,
      deletedAt: row.deletedAt,
      active: isKeyActive(row, now),
      pendingActivation: isKeyPendingActivation(row, now),
    };
  }
}
