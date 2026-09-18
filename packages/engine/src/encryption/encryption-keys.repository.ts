import { EntityManager, IsNull } from 'typeorm';
import { EncryptionKeyEntity } from './entity/encryption-key.entity';

/** What a caller supplies when storing a newly wrapped key; identity and timestamps are its own. */
export interface NewEncryptionKey {
  id: string;
  wrappedKey: string;
  createdBy: string | null;
  activatedAt: Date;
}

/**
 * Moves `encryption_keys` rows in and out of Postgres. Holds no crypto knowledge — wrapping and
 * unwrapping is `EncryptionKeyRingService`'s job; this repository only ever sees already-wrapped
 * material and moves it as opaque text, exactly as `ConnectorsRepository` does for connector
 * settings. Every method takes the caller's `EntityManager`, so a rotation that soft-deletes the
 * previous key and inserts the new one stays inside one transaction.
 */
export class EncryptionKeysRepository {
  /** Inserts a newly wrapped key. History is append-only — there is no update. */
  async insert(manager: EntityManager, key: NewEncryptionKey): Promise<void> {
    await manager.getRepository(EncryptionKeyEntity).insert({
      id: key.id,
      wrappedKey: key.wrappedKey,
      createdBy: key.createdBy,
      activatedAt: key.activatedAt,
    });
  }

  /** The single row with `deleted_at IS NULL`, or `null` before the first key has ever been created. */
  async findActive(manager: EntityManager): Promise<EncryptionKeyEntity | null> {
    return manager.getRepository(EncryptionKeyEntity).findOne({ where: { deletedAt: IsNull() } });
  }

  /** One key by id, active or historical, or `null` if no such id was ever issued. */
  async findById(manager: EntityManager, id: string): Promise<EncryptionKeyEntity | null> {
    return manager.getRepository(EncryptionKeyEntity).findOne({ where: { id } });
  }

  /** Every key ever created, most recent first — the full history the ring and the admin API both read. */
  async findAll(manager: EntityManager): Promise<EncryptionKeyEntity[]> {
    return manager.getRepository(EncryptionKeyEntity).find({ order: { createdAt: 'DESC' } });
  }

  /**
   * Serializes concurrent replicas' decision to write one `encryption.*` audit row for one key,
   * the same technique `ConnectorsRepository.lock` uses for a connector's settings: a
   * transaction-scoped advisory lock, released automatically by Postgres on commit or rollback,
   * keyed on `action` and `keyId` together so `reencryption_started` and `reencryption_completed`
   * for the *same* key never block each other. `ReEncryptionService` takes this for the duration
   * of a single "has this already been recorded; if not, insert it" transaction, so two replicas
   * racing to be the one that records a given step can never both observe "not yet recorded" —
   * see the "Cross-process audit bookkeeping" section of that class's doc comment.
   */
  async lockReEncryptionAudit(
    manager: EntityManager,
    action: string,
    keyId: string,
  ): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${action}:${keyId}`]);
  }

  /**
   * Soft-deletes the currently active (`deleted_at IS NULL`) row, if any, setting `deleted_at` to
   * `deletedAt` — a caller-supplied instant, not `now()`. `EncryptionAdminService.addKey` passes
   * the same future instant here as the incoming key's `activatedAt`, so the outgoing key keeps
   * protecting live writes until that instant arrives rather than the moment this statement runs;
   * see the "Exactly one active key" section of that class's doc comment. A no-op when the table
   * is empty or every row is already deleted, so a caller never has to check first. Never touches
   * `wrapped_key` — the material a soft-deleted row carries is retained for as long as any row
   * may still name it.
   */
  async softDeleteActive(manager: EntityManager, deletedAt: Date): Promise<void> {
    await manager.getRepository(EncryptionKeyEntity).update({ deletedAt: IsNull() }, { deletedAt });
  }

  /**
   * Single source of truth for "this onboarding's `context` still names a key other than the
   * active one" — the same predicate the migration's `idx_onboardings_encryption_key` expression
   * index was written for. Shared by `hasPendingReEncryption` (the steady-state probe),
   * `countReEncryptionStatus` (the exact progress count) and `claimPendingReEncryptionIds` (the
   * sweep's batch claim) so the three can never drift apart, the same discipline
   * `staleSendingLeasePredicates` applies in `webhook.repository.ts`. Expects the active key id
   * bound as the query's `$1` parameter. `context ? '__tsh_enc'` guards against a plaintext
   * context that happens to hold a `"k"` key of its own.
   */
  private static readonly PENDING_RE_ENCRYPTION_PREDICATE = `context ? '__tsh_enc' AND context ->> 'k' IS DISTINCT FROM $1`;

  /**
   * A bounded, indexable check for "is anything still pending" — `EXISTS (... LIMIT 1)` bound by
   * the predicate above, which `idx_onboardings_encryption_key` can serve directly, so this stops
   * at the first match rather than visiting every row. `ReEncryptionService` calls this on every
   * tick once a sweep has caught up (`pending` last read as `0` for the current active key),
   * reserving `countReEncryptionStatus`'s unconditional full-table scan for a newly observed
   * active key or a tick that actually found work — see that service's class doc comment.
   */
  async hasPendingReEncryption(manager: EntityManager, activeKeyId: string): Promise<boolean> {
    const [row] = await manager.query<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM onboardings
         WHERE ${EncryptionKeysRepository.PENDING_RE_ENCRYPTION_PREDICATE}
         LIMIT 1
       ) AS "exists"`,
      [activeKeyId],
    );

    return row?.exists ?? false;
  }

  /**
   * Derives re-encryption progress from `onboardings.context` itself — never a stored counter —
   * using {@link EncryptionKeysRepository.PENDING_RE_ENCRYPTION_PREDICATE}: `total` counts every
   * context carrying an encryption envelope, `pending` the ones whose envelope names a key other
   * than `activeKeyId`. Raw SQL rather than the entity's query builder, so this never runs
   * `onboardings.context`'s column transformer over rows it only needs to count. Deliberately
   * unconditional — it has no `WHERE` restricting `onboardings` itself, so unlike
   * `hasPendingReEncryption` it is always a full sequential scan, cheap only because
   * `GET /v1/admin/encryption/keys` calling it is a rare operator read, never the sweep's own
   * steady-state poll. When `activeKeyId` is `null` (no key has ever been created) every
   * enveloped row counts as pending, which is vacuously true and never actually observed once
   * encryption is enabled, since first boot always provisions a key before this can be called.
   */
  async countReEncryptionStatus(
    manager: EntityManager,
    activeKeyId: string | null,
  ): Promise<{ pending: number; total: number }> {
    const [row] = await manager.query<{ total: string; pending: string }[]>(
      `SELECT
         count(*) FILTER (WHERE context ? '__tsh_enc') AS total,
         count(*) FILTER (WHERE ${EncryptionKeysRepository.PENDING_RE_ENCRYPTION_PREDICATE}) AS pending
       FROM onboardings`,
      [activeKeyId],
    );

    return { pending: Number(row?.pending ?? 0), total: Number(row?.total ?? 0) };
  }

  /**
   * Claims up to `batchSize` onboarding ids still naming a non-active key, oldest id first, and
   * locks the matching rows for the caller's transaction with `FOR UPDATE SKIP LOCKED` — so the
   * sweep never blocks a live onboarding write, and two replicas sweeping at once simply skip
   * whichever rows the other already holds rather than blocking on them. Reuses
   * {@link EncryptionKeysRepository.PENDING_RE_ENCRYPTION_PREDICATE}, so this can never select a
   * different set of rows than `countReEncryptionStatus` reports as pending.
   *
   * Returns ids only, never entities: the caller (`ReEncryptionService`) loads the actual rows
   * through `manager.getRepository(OnboardingEntity)` within the same transaction, so the
   * `context` column's transformer — not this raw query — does the decrypt/re-encrypt work. A raw
   * `UPDATE` here would bypass that transformer and store plaintext.
   */
  async claimPendingReEncryptionIds(
    manager: EntityManager,
    activeKeyId: string,
    batchSize: number,
  ): Promise<string[]> {
    const rows = await manager.query<{ id: string }[]>(
      `SELECT id FROM onboardings
       WHERE ${EncryptionKeysRepository.PENDING_RE_ENCRYPTION_PREDICATE}
       ORDER BY id
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [activeKeyId, batchSize],
    );

    return rows.map((row) => row.id);
  }
}
