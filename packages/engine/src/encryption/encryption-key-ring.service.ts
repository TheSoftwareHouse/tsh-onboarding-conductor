import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppConfig } from '../config/app.config';
import { isEncryptionKeyConfigured, parseEncryptionKey } from '../config/encryption.config';
import { generateUuidV7 } from '../utils/uuid.util';
import { resolveActiveKeyId, resolveLatestDeactivatedKeyId } from './encryption-key-activation';
import { EncryptionKeysRepository } from './encryption-keys.repository';
import type { EncryptionKeyEntity } from './entity/encryption-key.entity';
import { EncryptionFailedError } from './errors/encryption-failed.error';
import { EncryptionKeyNotConfiguredError } from './errors/encryption-key-not-configured.error';
import { EncryptionKeyNotFoundError } from './errors/encryption-key-not-found.error';
import { EncryptionKeyUnwrapFailedError } from './errors/encryption-key-unwrap-failed.error';

/**
 * The in-process view of `encryption_keys`, unwrapped and ready to use. `activeKeyId` names the
 * key `encrypt` must use, or `null` while encryption is off; `keyFor` resolves whichever key an
 * already-stored envelope names, including one this replica has not seen yet; `reload` re-reads
 * the table. Consumed (not replaced) by `AesGcmEncryptionService`, in this same module — this
 * interface is the seam between the two.
 */
export interface EncryptionKeyRing {
  /**
   * The key new writes are encrypted with, or `null` while no key is active — the steady state
   * with encryption turned off, and also the window between an operator turning it on and the
   * new key's `activatedAt` arriving. Resolved on every call from the rows loaded at the last
   * `reload()` against the current time, so a scheduled activation or retirement takes effect at
   * the instant the table names, on every process alike, rather than at each process's next
   * reload; the rows themselves reach this within one `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS`.
   */
  activeKeyId(): string | null;
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
   * A key id that `reload()` did find but could not unwrap with the configured KEK — always an
   * inactive key, never the active one; see `reload()`'s doc comment — throws
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

/** What `activeKeyId` and `latestDeactivatedKeyId` need off a row — never its wrapped material. */
type ActivationRow = Pick<EncryptionKeyEntity, 'id' | 'activatedAt' | 'deletedAt'>;

/**
 * Unwraps every stored key with the key-encryption key (`ENCRYPTION_KEY`) into an in-process map
 * and keeps it fresh: a full reload at boot, a periodic one every
 * `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS`, and a deduped one on any miss. Never writes to the
 * table itself — `EncryptionAdminService` owns every change to `encryption_keys` — but it is the
 * one place the KEK is read from configuration and the wrap recipe lives, so `generateWrappedKey`
 * hands the admin service material it can store without knowing how it was sealed.
 *
 * A process with no KEK configured cannot unwrap anything. It boots only if `encryption_keys` is
 * empty — encryption has never been turned on, so there is nothing to read — and then holds an
 * empty ring with no active key and no refresh timer; `EncryptionModule` binds
 * `UnconfiguredEncryptionService` beside it. A non-empty table without a KEK fails boot outright
 * (`EncryptionKeyNotConfiguredError`): every onboarding those keys protect would be unreadable.
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
  /**
   * The activation windows of every row as of the last `reload()`. `activeKeyId` and
   * `latestDeactivatedKeyId` resolve against these with the current time on every call, so the
   * grace window `EncryptionAdminService` gives each change closes at exactly `activatedAt` /
   * `deletedAt` — not at whichever later moment this process happens to reload.
   */
  private rows: readonly ActivationRow[] = [];
  private reloadInFlight: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repository: EncryptionKeysRepository,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isKeyEncryptionKeyConfigured()) {
      const rows = await this.repository.findAll(this.dataSource.manager);

      if (rows.length > 0) {
        throw new EncryptionKeyNotConfiguredError(rows.length);
      }

      return;
    }

    await this.reload();

    // `engine` and `engine-worker` run as separate containers (see docker-compose.yml), so the
    // process serving reads is never the one that served the admin request changing the ring.
    // Without this timer a change would only reach a reading process the next time it happened
    // to take a miss — this makes that rare rather than guaranteed. `keyFor`'s on-miss fallback
    // (`scheduleReload`) is the backstop for a process that was down during a refresh window.
    const refreshIntervalMs = this.configService.getOrThrow<number>(
      'ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS',
    );
    this.timer = setInterval(() => this.scheduleReload(), refreshIntervalMs);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await this.reloadInFlight;
  }

  /**
   * Whether this process holds the key-encryption key at all. Decides which `EncryptionPort`
   * `EncryptionModule` binds, whether the sweep runs, and whether an operator may turn encryption
   * on or rotate a key from this process.
   */
  isKeyEncryptionKeyConfigured(): boolean {
    return isEncryptionKeyConfigured(this.configService.get('ENCRYPTION_KEY', { infer: true }));
  }

  activeKeyId(): string | null {
    return resolveActiveKeyId(this.rows, new Date());
  }

  /**
   * The key whose retirement most recently took effect, or `null` if none ever was — the key the
   * sweep is moving rows off while encryption is off, and the resource its `decryption_*` audit
   * rows are filed against. Resolved per call against the current time, like `activeKeyId`.
   */
  latestDeactivatedKeyId(): string | null {
    return resolveLatestDeactivatedKeyId(this.rows, new Date());
  }

  /**
   * Every key this process can currently decrypt with — unwrapped under the KEK at the last
   * `reload()` — active or not. What the sweep binds into its claim so it never selects a row
   * whose stored value it could not read.
   */
  resolvableKeyIds(): readonly string[] {
    return [...this.keys.keys()];
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
   * Unwraps every stored key with the KEK. Which key is **active** (per `resolveActiveKeyId`) is
   * computed up front, from the rows alone, so it never depends on the unwrap loop below having
   * reached it: if the configured KEK cannot open the active key, the engine cannot actually
   * operate, so that failure propagates and — at boot, where nothing catches it — stops startup.
   * Every other row is either superseded, retired, or still waiting on its `activatedAt` (see
   * `encryption-key-activation.ts`); nothing depends on it this instant, so a row that fails to
   * unwrap here is logged (by id only, never material) and excluded from the ring rather than
   * failing the whole reload. `keyFor` throws the distinct `EncryptionKeyUnwrapFailedError` for
   * an id excluded this way, rather than the generic `EncryptionKeyNotFoundError` it throws for an
   * id the table never had at all.
   *
   * Time-aware, not merely `deletedAt === null`: `EncryptionAdminService` gives an incoming key a
   * future `activatedAt` and an outgoing key a future `deletedAt`, so the row that holds
   * `deleted_at IS NULL` is not necessarily active yet, and a row whose `deleted_at` is set may
   * still be. That is what gives every replica a full refresh interval to learn of a change before
   * any write depends on it — see the class doc comment on `EncryptionAdminService`. The activation
   * windows themselves are kept (`rows`) so `activeKeyId` can re-resolve them on every call.
   */
  async reload(): Promise<void> {
    const rows = await this.repository.findAll(this.dataSource.manager);
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
    this.rows = rows.map(({ id, activatedAt, deletedAt }) => ({ id, activatedAt, deletedAt }));
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
   * Generates a new 32-byte data key and wraps it under the KEK (AAD = the new key's own id),
   * without touching the table or the ring. `EncryptionAdminService` persists the result as part
   * of its own transaction and calls `reload()` once that transaction commits. Wrapping stays
   * here because this is the one place the KEK is read from configuration and the AES-GCM recipe
   * is implemented — duplicating it at the call site would risk the two silently drifting apart.
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
