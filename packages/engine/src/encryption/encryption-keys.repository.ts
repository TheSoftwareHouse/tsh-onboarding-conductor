import { EntityManager, IsNull } from 'typeorm';
import { isUniqueViolation } from '../database/unique-violation';
import type { EncryptionKeyRotationInterval } from './encryption-key-rotation';
import { EncryptionKeyEntity } from './entity/encryption-key.entity';

/**
 * What a caller supplies when storing a newly wrapped key; identity and timestamps are its own.
 * `createdBy` is always the operator behind the request, or the unknown-actor marker when admin
 * auth is off — never absent: every key is created on an operator's request. The column stays
 * nullable only for rows inserted outside the API.
 */
export interface NewEncryptionKey {
  id: string;
  wrappedKey: string;
  createdBy: string;
  activatedAt: Date;
  /** The automatic-rotation schedule this key takes over, or `null` for none. */
  rotationInterval: EncryptionKeyRotationInterval | null;
}

/**
 * Where every `onboardings.context` row should end up. `activeKeyId` is the key encryption is on
 * with, or `null` while it is off and rows should end up as plain JSON. `sourceKeyIds` are the
 * keys this process can decrypt and that rows must move *off*, so the sweep never claims a row
 * whose stored value it could not read. Empty while encryption is on and no re-encryption is
 * outstanding: rotation is lazy, so a row already carrying an envelope is in an acceptable state
 * whichever key it names, and only plaintext rows are swept. Every resolvable key while encryption
 * is off, and every key but the active one while an operator's re-encryption request stands
 * (migration `0027`).
 */
export interface SweepTarget {
  readonly activeKeyId: string | null;
  readonly sourceKeyIds: readonly string[];
}

/** The partial unique index (migration `0024`) that admits at most one `deleted_at IS NULL` row. */
const ACTIVE_KEY_CONSTRAINT = 'uq_encryption_keys_active';

/**
 * Whether a failed write is the losing half of two transactions racing to claim the single
 * `deleted_at IS NULL` row — two operators turning encryption on, or two rotating, at the same
 * instant. `EncryptionAdminService` treats the first as "already on" and maps the second to a
 * named 409, instead of letting either surface as an unmapped 500.
 */
export function isActiveKeyConflict(error: unknown): boolean {
  return isUniqueViolation(error, ACTIVE_KEY_CONSTRAINT);
}

/**
 * The rows the sweep must move while encryption is off: every envelope naming a key this process
 * can read. Not used at all while encryption is on — rotation is lazy, so an enveloped row is
 * already in an acceptable state whichever key it names. Equality against a
 * bound list rather than `IS DISTINCT FROM <active>`: a btree cannot serve an inequality, but
 * `= ANY` on `idx_onboardings_encryption_key`'s expression is an index condition, and an envelope
 * naming a key the ring does not hold is left alone rather than claimed and failed on.
 */
const envelopedOnSourceKey = (position: number): string =>
  `context ? '__tsh_enc' AND context ->> 'k' = ANY($${position}::text[])`;

/**
 * Everything the sweep must move while encryption is on: every row still stored as plain JSON,
 * served by `idx_onboardings_plaintext_context` (migration `0025`) — an index that is empty, and
 * therefore free to check, once every row is encrypted.
 */
const PLAINTEXT = `NOT (context ? '__tsh_enc')`;

/** Rows this process has already found it cannot move; see `EncryptionSweepService`. */
const notExcluded = (position: number): string => `NOT (id = ANY($${position}::uuid[]))`;

/**
 * The one row predicate both the steady-state probe and the claim run, so the probe can never
 * report work the claim would not find. One direction, one partial index, never a disjunction of
 * the two: encryption on selects plaintext rows alone, encryption off every envelope on a readable
 * key. Returns the bind parameters the predicate actually references, in order — an unreferenced
 * parameter is a bind error, not a harmless extra.
 */
function buildSweepPredicate(
  target: SweepTarget,
  excludedOnboardingIds: readonly string[],
): [predicate: string, parameters: (readonly string[])[]] {
  if (target.activeKeyId === null) {
    return [
      `${envelopedOnSourceKey(1)} AND ${notExcluded(2)}`,
      [target.sourceKeyIds, excludedOnboardingIds],
    ];
  }

  // Encryption on with sources named: an operator asked for every row to move onto the active key,
  // so both halves are in play again and the disjunction is worth its cost for the length of the
  // run. With no sources — the steady state — only plaintext rows are pending.
  if (target.sourceKeyIds.length > 0) {
    return [
      `(${PLAINTEXT} OR (${envelopedOnSourceKey(1)})) AND ${notExcluded(2)}`,
      [target.sourceKeyIds, excludedOnboardingIds],
    ];
  }

  return [`${PLAINTEXT} AND ${notExcluded(1)}`, [excludedOnboardingIds]];
}

/**
 * The single id a `RETURNING id` update handed back, or `null` when it matched no row. Narrows
 * `UpdateResult.raw` (typed `any`) the same way `WebhookRepository.extractExpiredIds` does, rather
 * than asserting a shape onto it.
 */
function extractUpdatedKeyId(raw: unknown): string | null {
  if (!Array.isArray(raw)) {
    return null;
  }

  const id = (raw[0] as Record<string, unknown> | undefined)?.id;

  return typeof id === 'string' ? id : null;
}

/**
 * Moves `encryption_keys` rows in and out of Postgres, and runs the raw queries the sweep needs
 * over `onboardings`. Holds no crypto knowledge — wrapping and unwrapping is
 * `EncryptionKeyRingService`'s job; this repository only ever sees already-wrapped material and
 * moves it as opaque text, exactly as `ConnectorsRepository` does for connector settings. Every
 * method takes the caller's `EntityManager`, so a change that soft-deletes one key and inserts
 * another stays inside one transaction.
 */
export class EncryptionKeysRepository {
  /**
   * Inserts a newly wrapped key. Key material is append-only — no method here ever rewrites a
   * `wrapped_key`, an `id` or a `created_at`; `updateRotationInterval` and `softDeleteActive` move
   * the two columns that describe what the *active* key is currently doing, and nothing else.
   */
  async insert(manager: EntityManager, key: NewEncryptionKey): Promise<void> {
    await manager.getRepository(EncryptionKeyEntity).insert({
      id: key.id,
      wrappedKey: key.wrappedKey,
      createdBy: key.createdBy,
      activatedAt: key.activatedAt,
      rotationInterval: key.rotationInterval,
    });
  }

  /**
   * Writes the automatic-rotation schedule onto the currently active (`deleted_at IS NULL`) row,
   * or `null` to stop rotating automatically. Never touches `created_at`, which is what the
   * schedule is measured from: changing the interval re-measures the active key's existing age
   * against it rather than starting a fresh countdown.
   *
   * Returns the id of the row it actually wrote, or `null` when there was none — encryption is
   * off, so a caller can tell "the schedule is set" from "there was no key to set it on" without a
   * second read. The id comes back from the `UPDATE` itself rather than from a `findActive` the
   * caller made first, because under READ COMMITTED a rotation committing between those two
   * statements moves `deleted_at IS NULL` to a different row: the write would land on the incoming
   * key while the caller still held the superseded one, and the audit row would name a key that
   * never carried this schedule. `RETURNING` closes that window without a lock, and without the
   * spurious refusal a `SELECT ... FOR UPDATE` would produce for the caller that loses the race.
   */
  async updateRotationInterval(
    manager: EntityManager,
    rotationInterval: EncryptionKeyRotationInterval | null,
  ): Promise<string | null> {
    const result = await manager
      .getRepository(EncryptionKeyEntity)
      .createQueryBuilder()
      .update(EncryptionKeyEntity)
      .set({ rotationInterval })
      .where({ deletedAt: IsNull() })
      .returning(['id'])
      .execute();

    return extractUpdatedKeyId(result.raw);
  }

  /**
   * The single row with `deleted_at IS NULL` — the key encryption is on with, or is about to be
   * on with while its `activated_at` has not arrived — or `null` while encryption is off.
   */
  async findActive(manager: EntityManager): Promise<EncryptionKeyEntity | null> {
    return manager.getRepository(EncryptionKeyEntity).findOne({ where: { deletedAt: IsNull() } });
  }

  /** Every key ever created, most recent first — the full history the ring and the admin API both read. */
  async findAll(manager: EntityManager): Promise<EncryptionKeyEntity[]> {
    return manager.getRepository(EncryptionKeyEntity).find({ order: { createdAt: 'DESC' } });
  }

  /**
   * Serializes concurrent replicas' decision to write one `encryption.*` audit row for one key,
   * the same technique `ConnectorsRepository.lock` uses for a connector's settings: a
   * transaction-scoped advisory lock, released automatically by Postgres on commit or rollback,
   * keyed on `action` and `resourceId` together so a sweep's `*_started` and `*_completed` for the
   * same key never block each other. `EncryptionSweepService` takes this for the duration of a
   * single "has this already been recorded; if not, insert it" transaction, so two replicas racing
   * to be the one that records a given step can never both observe "not yet recorded".
   */
  async lockSweepAudit(manager: EntityManager, action: string, resourceId: string): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${action}:${resourceId}`]);
  }

  /**
   * Serializes the scheduled rotations of every replica against each other, the same
   * transaction-scoped advisory lock `lockSweepAudit` uses. `EncryptionKeyRotationService` holds
   * this for the whole of "is the active key due; if so, replace it", so the replica that arrives
   * second reads the key the first one just created and finds it not due, rather than rotating a
   * second time or colliding with `uq_encryption_keys_active`. An operator's own rotation
   * deliberately does not take it: an explicit "rotate now" is never a duplicate of anything, and
   * the unique index still refuses a second simultaneous one.
   */
  async lockKeyRotation(manager: EntityManager): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'encryption.scheduled_rotation',
    ]);
  }

  /**
   * Soft-deletes the currently active (`deleted_at IS NULL`) row, if any, setting `deleted_at` to
   * `deletedAt` — a caller-supplied instant, not `now()`. `EncryptionAdminService` passes a future
   * instant here (the incoming key's `activatedAt` on a rotation; one refresh interval ahead when
   * turning encryption off), so the outgoing key keeps protecting live writes until every replica
   * has learned of the change. Returns how many rows it marked — `0` when the table is empty or
   * every row is already deleted — so a caller can tell a rotation that found nothing to
   * supersede from one that did. Never touches `wrapped_key`: the material a soft-deleted row
   * carries is retained for as long as any row may still name it, and after.
   */
  async softDeleteActive(manager: EntityManager, deletedAt: Date): Promise<number> {
    const result = await manager
      .getRepository(EncryptionKeyEntity)
      .update({ deletedAt: IsNull() }, { deletedAt });

    return result.affected ?? 0;
  }

  /**
   * Records an operator's request to move every stored onboarding onto the active key, or clears
   * one the sweep has satisfied. Scoped to `deleted_at IS NULL` so a request can never land on a
   * retired key, and idempotent, so replicas racing to clear the same drained request agree.
   */
  async setReencryptRequestedAt(manager: EntityManager, requestedAt: Date | null): Promise<number> {
    const result = await manager
      .getRepository(EncryptionKeyEntity)
      .update({ deletedAt: IsNull() }, { reencryptRequestedAt: requestedAt });

    return result.affected ?? 0;
  }

  /**
   * A cheap "is anything still pending for this process" check, run on every idle tick of the
   * sweep. Each direction is a single predicate over one partial index — plaintext rows going in
   * (`idx_onboardings_plaintext_context`), enveloped rows on a readable key coming out
   * (`idx_onboardings_encryption_key`) — so the `EXISTS` stops at the first match, or in the
   * steady state at an empty index. Never a disjunction of the two: the planner answers an
   * `EXISTS` over `OR` with a sequential scan instead of either index.
   */
  async hasPendingSweep(
    manager: EntityManager,
    target: SweepTarget,
    excludedOnboardingIds: readonly string[],
  ): Promise<boolean> {
    const [predicate, parameters] = buildSweepPredicate(target, excludedOnboardingIds);

    const [row] = await manager.query<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM onboardings WHERE ${predicate}) AS "exists"`,
      parameters,
    );

    return row?.exists ?? false;
  }

  /**
   * The operator-facing progress: `total` counts every onboarding, `pending` the ones not yet in
   * the state the operator chose — still plain JSON while encryption is on, still an envelope
   * while it is off. A row on a superseded key is not pending: rotation is lazy, so it is already
   * in an acceptable state and moves to the current key when it is next written. Counting rows
   * *off* the active key instead, as this did before record `0026`, leaves a count that never
   * reaches zero once a rotation has happened — which is exactly what it should do while
   * `reencrypting` stands, since then every such row really is work outstanding. Raw SQL rather
   * than the entity's query
   * builder, so this never runs `onboardings.context`'s column transformer over rows it only
   * needs to count. Deliberately a full sequential scan: it counts against the *target*, not
   * against what this process can read, so it stays honest about a row the sweep cannot move
   * (see `EncryptionSweepService`), and it is cheap only because the sweep runs it on a tick that
   * has found work rather than on every idle tick — `hasPendingSweep` is the steady-state probe.
   */
  async countSweepStatus(
    manager: EntityManager,
    activeKeyId: string | null,
    reencrypting = false,
  ): Promise<{ pending: number; total: number }> {
    const [pendingFilter, parameters] =
      activeKeyId === null
        ? [`context ? '__tsh_enc'`, []]
        : reencrypting
          ? [`${PLAINTEXT} OR context ->> 'k' IS DISTINCT FROM $1`, [activeKeyId]]
          : [PLAINTEXT, []];

    const [row] = await manager.query<{ total: string; pending: string }[]>(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE ${pendingFilter}) AS pending
         FROM onboardings`,
      parameters,
    );

    return { pending: Number(row?.pending ?? 0), total: Number(row?.total ?? 0) };
  }

  /**
   * Claims up to `batchSize` onboarding ids this process can move toward `target`, and locks the
   * matching rows for the caller's transaction with `FOR UPDATE SKIP LOCKED` — so the sweep never
   * blocks a live onboarding write, and two replicas sweeping at once simply skip whichever rows
   * the other already holds rather than blocking on them. No `ORDER BY`: ordering by id would
   * force a walk of the primary key with the predicate as a filter, growing quadratic as a sweep
   * moves the low ids first, and the sweep needs no particular order. Bound by the same two
   * fragments as `hasPendingSweep`, so the probe can never report work this claim would not find.
   *
   * Returns ids only, never entities: the caller (`EncryptionSweepService`) loads each row
   * through `manager.getRepository(OnboardingEntity)` within the same transaction, so the
   * `context` column's transformer — not this raw query — does the decrypt and re-encrypt work. A
   * raw `UPDATE` here would bypass that transformer and store plaintext.
   */
  async claimPendingSweepIds(
    manager: EntityManager,
    target: SweepTarget,
    batchSize: number,
    excludedOnboardingIds: readonly string[],
  ): Promise<string[]> {
    const [predicate, predicateParameters] = buildSweepPredicate(target, excludedOnboardingIds);
    // The batch size is always the last bind parameter, whichever direction supplied the rest.
    const parameters = [...predicateParameters, batchSize];

    const rows = await manager.query<{ id: string }[]>(
      `SELECT id FROM onboardings
       WHERE ${predicate}
       LIMIT $${parameters.length}
       FOR UPDATE SKIP LOCKED`,
      parameters,
    );

    return rows.map((row) => row.id);
  }
}
