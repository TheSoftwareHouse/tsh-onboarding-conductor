import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import { AuditService } from '../audit/audit.service';
import { AppConfig } from '../config/app.config';
import {
  isKeyActive,
  isKeyPendingActivation,
  resolveActiveKeyId,
} from './encryption-key-activation';
import { EncryptionKeyRingService, isActiveKeyConflict } from './encryption-key-ring.service';
import { EncryptionKeysRepository } from './encryption-keys.repository';
import type { EncryptionKeyEntity } from './entity/encryption-key.entity';
import { EncryptionDisabledException } from './errors/encryption-disabled.exception';
import { EncryptionKeyRotationConflictException } from './errors/encryption-key-rotation-conflict.exception';

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
   * arrived yet — the grace window `addKey` opens so every replica has a chance to learn of it
   * before anything encrypts with it. Never `true` for more than one row at a time.
   */
  pendingActivation: boolean;
}>;

export type ReEncryptionProgressView = Readonly<{
  /** Onboarding contexts still naming a key other than the active one. */
  pending: number;
  /** Every onboarding context carrying an encryption envelope. */
  total: number;
}>;

export type EncryptionKeysView = Readonly<{
  keys: readonly EncryptionKeyView[];
  reEncryption: ReEncryptionProgressView;
}>;

/**
 * The admin read/write surface behind `/v1/admin/encryption/keys`: `listKeys` and `addKey`. Mirrors
 * `ConnectorSettingsAdminService`'s split from persistence — `EncryptionKeysRepository` moves rows,
 * this service orchestrates and is the only class in `src/encryption` that writes audit rows.
 *
 * `addKey` is the only place `encryption_keys` gains a row after first boot: it soft-deletes the
 * current active key and inserts the new one in one transaction (the partial unique index refuses
 * a moment with zero or two active rows), reloads the local ring so this process's own view of
 * the table is immediately up to date, then audits `key_added` and, when a previous key existed,
 * `key_superseded` — both *after* the transaction has committed, so a failed audit write can never
 * roll back a change already made durable. That reload makes the new row *known* to this process
 * at once; it does not make the new key *active* at once — see below.
 *
 * ### Exactly one active key, including during rotation
 *
 * Reloading the ring immediately after the transaction commits means this process starts
 * stamping ordinary onboarding writes with the new key id right away — but a peer replica only
 * learns that key exists after its own next periodic reload, up to
 * `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS` later. A row written in that window and read on the
 * peer first would throw `EncryptionKeyNotFoundError`. `addKey` closes that gap by never making
 * the new key *usable* the instant it exists: the outgoing key's `deletedAt` and the incoming
 * key's `activatedAt` are set to the **same future instant**, `now + refreshIntervalMs`, rather
 * than to `now`. `isKeyActive` (`encryption-key-activation.ts`) admits a row only once its
 * `activatedAt` has arrived and only until its `deletedAt` arrives, so between the rotation and
 * that instant the *outgoing* key is still the one every ring — including this process's own,
 * freshly reloaded one — resolves as active, and every peer has a full refresh interval to learn
 * the incoming key exists before it ever needs to decrypt (or encrypt) anything with it. At the
 * threshold itself the two flip together: the outgoing key's window closes exactly when the
 * incoming key's opens, so there is never an instant with zero or two active keys, matching
 * `uq_encryption_keys_active`'s invariant (which this never changes — it governs `deletedAt IS
 * NULL`, still exactly one row at a time) with a second, time-based invariant on top of it. A
 * second rotation issued before the first's grace window elapses composes correctly without any
 * special case: it always soft-deletes whichever row currently holds `deletedAt IS NULL` — the
 * incoming key of the *previous* rotation, not necessarily today's active one — so the chain of
 * activation windows simply extends rather than overlapping or leaving a gap.
 *
 * A key's material is never removed once it stops being active — `EncryptionKeysRepository`
 * never deletes a row, only marks it — so `keyFor` keeps resolving it for as long as any row may
 * still name it, rotation or not.
 */
@Injectable()
export class EncryptionAdminService {
  constructor(
    private readonly repository: EncryptionKeysRepository,
    private readonly ring: EncryptionKeyRingService,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /**
   * The full key history, most recent first, plus derived re-encryption progress. Reports no
   * keys and no progress when encryption is disabled — there is no ring and nothing to rotate,
   * so answering with an empty history is more honest than a 4xx for a plain read.
   */
  async listKeys(): Promise<EncryptionKeysView> {
    if (!this.isEnabled()) {
      return { keys: [], reEncryption: { pending: 0, total: 0 } };
    }

    const manager = this.dataSource.manager;
    const rows = await this.repository.findAll(manager);
    const now = new Date();
    const activeKeyId = resolveActiveKeyId(rows, now);
    const { pending, total } = await this.repository.countReEncryptionStatus(manager, activeKeyId);

    return {
      keys: rows.map((row) => this.toView(row, now)),
      reEncryption: { pending, total },
    };
  }

  /**
   * Generates and wraps a new key, replaces the active row with it, reloads the ring, and audits
   * both halves of the rotation. Refuses with a named 4xx rather than a 500 when encryption is
   * disabled: there is no KEK configured to wrap a key with and no ring for one to join.
   */
  async addKey(actorId: string): Promise<{ id: string }> {
    if (!this.isEnabled()) {
      throw new EncryptionDisabledException();
    }

    const resolvedActorId = actorId === '' ? ADMIN_ACCESS_UNKNOWN_ACTOR : actorId;
    const { id, wrappedKey } = this.ring.generateWrappedKey();
    const refreshIntervalMs = this.configService.get('ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS', {
      infer: true,
    });
    // The grace threshold: the outgoing key's `deletedAt` and this key's `activatedAt`, both set
    // to the same future instant rather than `now`. See "Exactly one active key" above.
    const activatedAt = new Date(Date.now() + refreshIntervalMs);

    let previousKeyId: string | null;

    try {
      previousKeyId = await this.dataSource.transaction(async (manager) => {
        const active = await this.repository.findActive(manager);
        await this.repository.softDeleteActive(manager, activatedAt);
        await this.repository.insert(manager, {
          id,
          wrappedKey,
          createdBy: resolvedActorId,
          activatedAt,
        });

        return active?.id ?? null;
      });
    } catch (error) {
      // Two concurrent `addKey` calls racing under READ COMMITTED: the loser's soft-delete
      // matches nothing (the winner already claimed the one `deletedAt IS NULL` row) and its own
      // insert then collides with `uq_encryption_keys_active`. The invariant held — refuse with a
      // named conflict, not an unmapped 500.
      if (isActiveKeyConflict(error)) {
        throw new EncryptionKeyRotationConflictException();
      }

      throw error;
    }

    await this.ring.reload();

    await this.auditService.logEncryption(this.dataSource, {
      action: 'encryption.key_added',
      actorType: 'operator',
      actorId: resolvedActorId,
      resourceId: id,
      metadata: { keyId: id },
    });

    if (previousKeyId !== null) {
      await this.auditService.logEncryption(this.dataSource, {
        action: 'encryption.key_superseded',
        actorType: 'operator',
        actorId: resolvedActorId,
        resourceId: previousKeyId,
        metadata: { keyId: id, supersededKeyId: previousKeyId },
      });
    }

    return { id };
  }

  private isEnabled(): boolean {
    return this.configService.get('ENCRYPTION_ENABLED', { infer: true });
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
