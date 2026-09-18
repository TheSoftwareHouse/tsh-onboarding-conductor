import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AppConfig } from '../config/app.config';
import { parseEncryptionKey } from '../config/encryption.config';
import { EncryptionFailedError } from './errors/encryption-failed.error';
import { generateUuidV7 } from '../utils/uuid.util';
import { resolveActiveKeyId } from './encryption-key-activation';
import { EncryptionKeysRepository } from './encryption-keys.repository';
import { EncryptionKeyNotFoundError } from './errors/encryption-key-not-found.error';
import { EncryptionKeyUnwrapFailedError } from './errors/encryption-key-unwrap-failed.error';

/**
 * The in-process view of `encryption_keys`, unwrapped and ready to use. `activeKeyId` names the
 * key `encrypt` must use; `keyFor` resolves whichever key an already-stored envelope names,
 * including one this replica has not seen yet; `reload` re-reads the table. Consumed (not
 * replaced) by `AesGcmEncryptionService`, in this same module — this interface is the seam
 * between the two.
 */
export interface EncryptionKeyRing {
  activeKeyId(): string;
  /**
   * Reloads the table exactly once on a miss, then throws `EncryptionKeyNotFoundError` if the id
   * is still unknown. Synchronous by design: TypeORM's column transformers — the only place a
   * stored key id is actually resolved — are themselves synchronous, so this cannot await the
   * reload it triggers. A miss instead schedules a reload in the background (deduped so a burst
   * of misses, for example while decrypting a full page of rows, costs one reload rather than
   * one per row) and always throws for its own call; a *later* call for the same id, once that
   * reload has landed, either succeeds or throws again having actually checked the refreshed
   * table. This is what lets a key created on one replica reach another without a restart.
   *
   * A key id that `reload()` did find but could not unwrap with the configured KEK — always a
   * superseded key, never the active one; see `reload()`'s doc comment — throws
   * `EncryptionKeyUnwrapFailedError` instead, so a caller (and an operator reading the error) can
   * tell "this key never existed" apart from "this key exists but the KEK cannot open it".
   */
  keyFor(keyId: string): Buffer;
  reload(): Promise<void>;
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const DATA_KEY_BYTES = 32;

/** Postgres' unique-violation class, and the constraint that guards at most one active key. */
const UNIQUE_VIOLATION_CODE = '23505';
const ACTIVE_KEY_CONSTRAINT = 'uq_encryption_keys_active';

type PostgresErrorFields = {
  code?: string;
  constraint?: string;
};

/**
 * Whether a failed insert is the losing half of two transactions racing to claim the single
 * `deleted_at IS NULL` row — the first-boot bootstrap below racing another replica, or
 * `EncryptionAdminService.addKey` racing a concurrent rotation. Matching the constraint by name
 * keeps an unrelated unique violation from being swallowed here. Exported so `addKey` can map
 * this exact shape to a named 409 instead of letting it surface as an unmapped 500.
 */
export function isActiveKeyConflict(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }

  const driverError = (error as { driverError?: PostgresErrorFields }).driverError;
  const fields: PostgresErrorFields = driverError ?? (error as PostgresErrorFields);

  return fields.code === UNIQUE_VIOLATION_CODE && fields.constraint === ACTIVE_KEY_CONSTRAINT;
}

/**
 * Unwraps every stored key with the key-encryption key (`ENCRYPTION_KEY`) into an in-process map,
 * and provisions the first key itself when `ENCRYPTION_ENABLED=true` and the table is still
 * empty — turning the flag on keeps working with nothing but `.env`, exactly as it does before
 * this module exists, because the table stays an implementation detail until an operator chooses
 * to rotate. That first-boot provisioning is the engine acting on its own initiative and belongs
 * in the audit log, not merely the application log — `bootstrapFirstKey` audits it as
 * `encryption.initial_key_created`. `generateWrappedKey` exposes the same wrap/KEK machinery to
 * `EncryptionAdminService`, which owns the rest of a rotation.
 */
@Injectable()
export class EncryptionKeyRingService implements EncryptionKeyRing, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EncryptionKeyRingService.name);
  private keys = new Map<string, Buffer>();
  /**
   * Ids `reload()` found in the table but could not unwrap, because they were not the active key
   * at that reload — see `reload()`'s doc comment. Rebuilt from scratch on every `reload()`, so a
   * key that starts unwrapping again (an `ENCRYPTION_KEY` fixed back to what it was) simply stops
   * appearing here rather than needing to be cleared explicitly.
   */
  private unwrappableKeyIds = new Set<string>();
  private activeId: string | null = null;
  private reloadInFlight: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repository: EncryptionKeysRepository,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly auditService: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.configService.get('ENCRYPTION_ENABLED', { infer: true })) {
      return;
    }

    await this.bootstrapFirstKey();
    await this.reload();

    // `engine` and `engine-worker` run as separate containers (see docker-compose.yml), so the
    // process serving reads is never the one running the re-encryption sweep. Without this timer
    // a rotation would only reach a reading process the next time it happened to take a miss —
    // this makes that rare rather than guaranteed. `keyFor`'s on-miss fallback (`scheduleReload`)
    // stays exactly as it was; it is now the fallback for a process that was down during a
    // refresh window, not the primary way staleness is fixed.
    const refreshIntervalMs = this.configService.get('ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS', {
      infer: true,
    });
    this.timer = setInterval(() => this.scheduleReload(), refreshIntervalMs);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await this.reloadInFlight;
  }

  activeKeyId(): string {
    if (this.activeId === null) {
      throw new EncryptionKeyNotFoundError('active');
    }

    return this.activeId;
  }

  keyFor(keyId: string): Buffer {
    const key = this.keys.get(keyId);

    if (key) {
      return key;
    }

    if (this.unwrappableKeyIds.has(keyId)) {
      throw new EncryptionKeyUnwrapFailedError(keyId);
    }

    this.scheduleReload();

    throw new EncryptionKeyNotFoundError(keyId);
  }

  /**
   * Unwraps every stored key with the KEK. The **active** key (per `resolveActiveKeyId`, computed
   * from the un-unwrapped rows so this does not depend on unwrapping having already succeeded) is
   * the one `encrypt` must use right now: if the configured KEK cannot open it, the engine cannot
   * actually operate, so that failure propagates exactly as before and — at boot, where nothing
   * catches it — stops startup. Every other row is either genuinely superseded or still waiting on
   * its `activatedAt` (see `encryption-key-activation.ts`); either way nothing depends on it this
   * instant, so a row that fails to unwrap here is logged (by id only, never material) and simply
   * excluded from the ring rather than failing the whole reload. `keyFor` throws the distinct
   * `EncryptionKeyUnwrapFailedError` for an id excluded this way, rather than the generic
   * `EncryptionKeyNotFoundError` it throws for an id the table never had at all — see its doc
   * comment on the `EncryptionKeyRing` interface.
   */
  async reload(): Promise<void> {
    const rows = await this.repository.findAll(this.dataSource.manager);
    // Time-aware, not merely `deletedAt === null`: `addKey` gives the incoming key a future
    // `activatedAt` and the outgoing key a matching future `deletedAt`, so the row that will
    // eventually hold `deletedAt IS NULL` is not necessarily active yet. See
    // `encryption-key-activation.ts` and the "Exactly one active key" section of the class doc
    // comment on `EncryptionAdminService`. Computed up front, from the rows alone, so which key is
    // active never depends on the unwrap loop below having reached it yet.
    const activeKeyId = resolveActiveKeyId(rows, new Date());

    const nextKeys = new Map<string, Buffer>();
    const nextUnwrappableKeyIds = new Set<string>();

    for (const row of rows) {
      try {
        nextKeys.set(row.id, this.unwrap(row.id, row.wrappedKey));
      } catch (error) {
        if (row.id === activeKeyId) {
          throw error;
        }

        nextUnwrappableKeyIds.add(row.id);
        this.logger.warn(
          `Encryption key "${row.id}" could not be unwrapped with the configured ` +
            'ENCRYPTION_KEY and was excluded from the ring. It is not the active key, so this ' +
            'is not fatal, but keyFor() will throw EncryptionKeyUnwrapFailedError for it until ' +
            'the key-encryption key is restored.',
        );
      }
    }

    this.keys = nextKeys;
    this.unwrappableKeyIds = nextUnwrappableKeyIds;
    this.activeId = activeKeyId;
  }

  /**
   * Kicks off a reload if one is not already running, and tracks it in `reloadInFlight` so
   * `onModuleDestroy` can wait for it. Shared by `keyFor`'s on-miss fallback and the periodic
   * timer, so the two never run a reload concurrently. A rejection is logged, never thrown here —
   * a failed reload must never kill the timer, and `keyFor` cannot propagate an async failure
   * from a call it made synchronously.
   */
  private scheduleReload(): void {
    if (this.reloadInFlight) {
      return;
    }

    this.reloadInFlight = this.reload()
      .catch((error: unknown) => {
        this.logger.error('Failed to reload the encryption key ring', error as Error);
      })
      .finally(() => {
        this.reloadInFlight = null;
      });
  }

  /**
   * Generates, wraps and stores the first key when the table is empty; a no-op when one already
   * exists. Two replicas booting at once can both observe an empty table and both attempt this;
   * the loser hits `uq_encryption_keys_active` and simply defers to whichever row won — `reload`
   * right after this picks up whichever one that was.
   */
  private async bootstrapFirstKey(): Promise<void> {
    const manager = this.dataSource.manager;
    const active = await this.repository.findActive(manager);

    if (active) {
      return;
    }

    const id = generateUuidV7();
    const dataKey = randomBytes(DATA_KEY_BYTES);
    const now = new Date();

    try {
      await this.repository.insert(manager, {
        id,
        wrappedKey: this.wrap(id, dataKey),
        createdBy: null,
        activatedAt: now,
      });
    } catch (error) {
      if (!isActiveKeyConflict(error)) {
        throw error;
      }

      // Lost the race to another replica: that process's own insert is the one this boot's
      // provisioning audits, not this one's failed attempt.
      return;
    }

    // Audited, not merely logged: this is the engine acting on its own initiative. Written after
    // the insert above has already committed, and never awaited into a boot failure — a key that
    // is durably stored must not be undone by a trail write that could not be made.
    this.auditService
      .logEncryption(this.dataSource, {
        action: 'encryption.initial_key_created',
        actorType: 'system',
        actorId: 'engine',
        resourceId: id,
        metadata: { keyId: id },
      })
      .catch((error: unknown) => {
        this.logger.error('Failed to audit first-boot key provisioning', error as Error);
      });
  }

  /**
   * Generates a new 32-byte data key and wraps it under the KEK (AAD = the new key's own id),
   * without touching the table or the ring. `EncryptionAdminService.addKey` persists the result
   * as part of its own rotation transaction and calls `reload()` once that transaction commits.
   * Wrapping stays here, alongside `bootstrapFirstKey`'s, because this is the one place the KEK
   * is read from configuration and the AES-GCM recipe is implemented — duplicating it at the
   * call site would risk the two silently drifting apart.
   */
  generateWrappedKey(): { id: string; wrappedKey: string } {
    const id = generateUuidV7();

    return { id, wrappedKey: this.wrap(id, randomBytes(DATA_KEY_BYTES)) };
  }

  /** Wraps a 32-byte data key under the KEK, with the key's own id as AAD. */
  private wrap(keyId: string, dataKey: Buffer): string {
    const kek = this.kek();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, kek, iv);
    cipher.setAAD(Buffer.from(keyId, 'utf8'));

    const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  /**
   * Unwraps a stored key under the KEK, with the key's own id as AAD — so a wrapped value copied
   * onto a different row's id fails to unwrap rather than silently returning the wrong material.
   */
  private unwrap(keyId: string, wrappedKey: string): Buffer {
    const kek = this.kek();
    const raw = Buffer.from(wrappedKey, 'base64');

    if (raw.length < IV_BYTES + AUTH_TAG_BYTES) {
      throw new EncryptionFailedError(
        `wrapped key "${keyId}" is too short to contain an IV and auth tag`,
      );
    }

    const iv = raw.subarray(0, IV_BYTES);
    const authTag = raw.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES + AUTH_TAG_BYTES);

    try {
      const decipher = createDecipheriv(ALGORITHM, kek, iv);
      decipher.setAAD(Buffer.from(keyId, 'utf8'));
      decipher.setAuthTag(authTag);

      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      // Never surface the underlying node:crypto error: it can include buffer contents, and the
      // caller only needs to know unwrapping failed, never why at the byte level.
      throw new EncryptionFailedError(`wrapped key "${keyId}" failed to unwrap`);
    }
  }

  private kek(): Buffer {
    return parseEncryptionKey(this.configService.get('ENCRYPTION_KEY', { infer: true }));
  }
}
