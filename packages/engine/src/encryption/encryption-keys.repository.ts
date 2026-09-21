import { EntityManager, IsNull } from 'typeorm';
import { isUniqueViolation } from '../database/unique-violation';
import { EncryptionKeyEntity } from './entity/encryption-key.entity';

/** What a caller supplies when storing a newly wrapped key; identity and timestamps are its own. */
export interface NewEncryptionKey {
  id: string;
  wrappedKey: string;
  createdBy: string | null;
  activatedAt: Date;
}

/**
 * Where every `onboardings.context` row should end up. `activeKeyId` is the key encryption is on
 * with, or `null` while it is off and rows should end up as plain JSON. `sourceKeyIds` are the
 * keys this process can decrypt and that rows must move *off* — every resolvable key except the
 * active one — so the sweep never claims a row whose stored value it could not read.
 */
export interface SweepTarget {
  readonly activeKeyId: string | null;
  readonly sourceKeyIds: readonly string[];
}

/** The partial unique index (migration `0024`) that admits at most one `deleted_at IS NULL` row. */
const ACTIVE_KEY_CONSTRAINT = 'uq_encryption_keys_active';

/**
 * Whether a failed write is the losing half of two transactions racing to claim the single
 * `deleted_at IS NULL` row — two operators turning encryption on, or one rotating while another
 * rotates, at the same instant. `EncryptionAdminService` maps this exact shape to a named 409
 * instead of letting it surface as an unmapped 500.
 */
export function isActiveKeyConflict(error: unknown): boolean {
  return isUniqueViolation(error, ACTIVE_KEY_CONSTRAINT);
}

/**
 * The rows the sweep must move while encryption is off — and the enveloped half of what it must
 * move while it is on: every envelope naming a key this process can read. Equality against a
 * bound list rather than `IS DISTINCT FROM <active>`: a btree cannot serve an inequality, but
 * `= ANY` on `idx_onboardings_encryption_key`'s expression is an index condition, and an envelope
 * naming a key the ring does not hold is left alone rather than claimed and failed on.
 */
const ENVELOPED_ON_SOURCE_KEY = `context ? '__tsh_enc' AND context ->> 'k' = ANY($1::text[])`;

/**
 * The other half of what the sweep must move while encryption is on: every row still stored as
 * plain JSON, served by `idx_onboardings_plaintext_context` (migration `0025`) — an index that is
 * empty, and therefore free to check, once every row is encrypted.
 */
const PLAINTEXT = `NOT (context ? '__tsh_enc')`;

/** Rows this process has already found it cannot move; see `EncryptionSweepService`. */
const NOT_EXCLUDED = `NOT (id = ANY($2::uuid[]))`;

/**
 * Moves `encryption_keys` rows in and out of Postgres, and runs the raw queries the sweep needs
 * over `onboardings`. Holds no crypto knowledge — wrapping and unwrapping is
 * `EncryptionKeyRingService`'s job; this repository only ever sees already-wrapped material and
 * moves it as opaque text, exactly as `ConnectorsRepository` does for connector settings. Every
 * method takes the caller's `EntityManager`, so a change that soft-deletes one key and inserts
 * another stays inside one transaction.
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
   * A cheap "is anything still pending for this process" check, run on every idle tick of the
   * sweep. Two single-index `EXISTS` probes joined by `OR` rather than one query with the
   * disjunction inside it: given the disjunction, the planner falls back to a sequential scan for
   * an `EXISTS`, while each half on its own is an index scan that stops at the first match — or,
   * in the steady state, at an empty index.
   */
  async hasPendingSweep(
    manager: EntityManager,
    target: SweepTarget,
    excludedOnboardingIds: readonly string[],
  ): Promise<boolean> {
    const enveloped = `EXISTS (SELECT 1 FROM onboardings WHERE ${ENVELOPED_ON_SOURCE_KEY} AND ${NOT_EXCLUDED})`;
    const plaintext = `EXISTS (SELECT 1 FROM onboardings WHERE ${PLAINTEXT} AND ${NOT_EXCLUDED})`;
    const sql =
      target.activeKeyId === null
        ? `SELECT ${enveloped} AS "exists"`
        : `SELECT (${plaintext} OR ${enveloped}) AS "exists"`;

    const [row] = await manager.query<{ exists: boolean }[]>(sql, [
      target.sourceKeyIds,
      excludedOnboardingIds,
    ]);

    return row?.exists ?? false;
  }

  /**
   * The operator-facing progress: `total` counts every onboarding, `pending` the ones not yet in
   * the state the operator chose — plain JSON or on a key other than `activeKeyId` while
   * encryption is on, still an envelope while it is off. Raw SQL rather than the entity's query
   * builder, so this never runs `onboardings.context`'s column transformer over rows it only
   * needs to count. Deliberately a full sequential scan: it counts against the *target*, not
   * against what this process can read, so it stays honest about a row the sweep cannot move
   * (see `EncryptionSweepService`), and it is cheap only because the sweep runs it on a tick that
   * has found work rather than on every idle tick — `hasPendingSweep` is the steady-state probe.
   */
  async countSweepStatus(
    manager: EntityManager,
    activeKeyId: string | null,
  ): Promise<{ pending: number; total: number }> {
    const [sql, parameters] =
      activeKeyId === null
        ? [
            `SELECT count(*) AS total,
                    count(*) FILTER (WHERE context ? '__tsh_enc') AS pending
               FROM onboardings`,
            [],
          ]
        : [
            `SELECT count(*) AS total,
                    count(*) FILTER (
                      WHERE ${PLAINTEXT} OR context ->> 'k' IS DISTINCT FROM $1
                    ) AS pending
               FROM onboardings`,
            [activeKeyId],
          ];

    const [row] = await manager.query<{ total: string; pending: string }[]>(sql, parameters);

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
    const pending =
      target.activeKeyId === null
        ? ENVELOPED_ON_SOURCE_KEY
        : `(${PLAINTEXT} OR (${ENVELOPED_ON_SOURCE_KEY}))`;

    const rows = await manager.query<{ id: string }[]>(
      `SELECT id FROM onboardings
       WHERE ${pending} AND ${NOT_EXCLUDED}
       LIMIT $3
       FOR UPDATE SKIP LOCKED`,
      [target.sourceKeyIds, excludedOnboardingIds, batchSize],
    );

    return rows.map((row) => row.id);
  }
}
