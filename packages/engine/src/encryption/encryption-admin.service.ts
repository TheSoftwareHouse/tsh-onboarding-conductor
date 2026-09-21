import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import { AuditService } from '../audit/audit.service';
import { AppConfig } from '../config/app.config';
import { isKeyActive, isKeyPendingActivation } from './encryption-key-activation';
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
  progress: SweepProgressView;
}>;

/**
 * The admin read/write surface behind `/v1/admin/encryption`: `getState`, `setEnabled` and
 * `addKey`. Mirrors `ConnectorSettingsAdminService`'s split from persistence —
 * `EncryptionKeysRepository` moves rows, this service orchestrates and writes the operator-driven
 * audit rows (`enabled`, `disabled`, `key_added`, `key_superseded`); the sweep writes its own.
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
   * Generates and wraps a new key, replaces the active row with it, reloads the ring, and audits
   * both halves of the rotation. Refuses with a named 4xx rather than a 500 when encryption is
   * off — there is no active key to supersede — or when this process holds no key-encryption key.
   */
  async addKey(actorId: string): Promise<{ id: string }> {
    this.assertKeyConfigured();

    const resolvedActorId = actorId === '' ? ADMIN_ACCESS_UNKNOWN_ACTOR : actorId;
    const { id, wrappedKey } = this.ring.generateWrappedKey();
    const previousKeyId = await this.rotateActiveKey({
      id,
      wrappedKey,
      createdBy: resolvedActorId,
      activatedAt: this.graceThreshold(),
    });

    await this.reloadRing();

    await this.auditService.logEncryption(this.dataSource, {
      action: 'encryption.key_added',
      actorType: 'operator',
      actorId: resolvedActorId,
      resourceId: id,
      metadata: { keyId: id },
    });
    await this.auditService.logEncryption(this.dataSource, {
      action: 'encryption.key_superseded',
      actorType: 'operator',
      actorId: resolvedActorId,
      resourceId: previousKeyId,
      metadata: { keyId: id, supersededKeyId: previousKeyId },
    });

    return { id };
  }

  private async enable(actorId: string): Promise<void> {
    this.assertKeyConfigured();

    const { id, wrappedKey } = this.ring.generateWrappedKey();
    const inserted = await this.insertFirstKey({
      id,
      wrappedKey,
      createdBy: actorId,
      activatedAt: this.graceThreshold(),
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
   * Soft-deletes the current `deleted_at IS NULL` row and inserts `key` in one transaction, so
   * the partial unique index never sees two such rows and a failure leaves the previous one in
   * place. Returns the superseded key's id. Refuses when there is nothing to supersede — whether
   * encryption was already off, or a concurrent request turned it off between this transaction's
   * read and its write (`softDeleteActive` then marks nothing) — and maps the unique-violation
   * race between two rotations to a named 409.
   */
  private async rotateActiveKey(key: NewEncryptionKey): Promise<string> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const active = await this.repository.findActive(manager);

        if (active === null) {
          throw new EncryptionDisabledException();
        }

        const superseded = await this.repository.softDeleteActive(manager, key.activatedAt);

        if (superseded === 0) {
          throw new EncryptionDisabledException();
        }

        await this.repository.insert(manager, key);

        return active.id;
      });
    } catch (error) {
      if (isActiveKeyConflict(error)) {
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
