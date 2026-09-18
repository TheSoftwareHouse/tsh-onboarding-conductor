import { EntityManager } from 'typeorm';
import {
  paginateQueryBuilder,
  resolvePaginationWindow,
  type PaginatedResult,
  type PaginationWindow,
} from '../pagination';
import { generateUuidV7 } from '../utils/uuid.util';
import { type AgreementType } from './agreement.types';
import { AgreementEntity } from './entity/agreement.entity';
import { AgreementVersionEntity } from './entity/agreement-version.entity';

/** What the published-versions listing narrows on, beside the inherited `page`/`limit` window. */
export interface AgreementListFilters extends Partial<PaginationWindow> {
  key?: string;
  type?: AgreementType;
}

/** One `agreement_versions` row as Postgres hands it back from a statement written by hand. */
interface AgreementVersionRow {
  agreement_version_id: string;
  agreement_id: string;
  version: number;
  published_at: Date;
  created_at: Date;
}

/** One `agreements`-joined-to-`agreement_versions` row, as the bulk latest-version read returns it. */
interface LatestAgreementVersionRow extends AgreementVersionRow {
  key: string;
  type: AgreementType;
}

function toAgreementVersion(
  row: AgreementVersionRow,
  key: string,
  type: AgreementType,
): AgreementVersionEntity {
  return Object.assign(new AgreementVersionEntity(), {
    agreementVersionId: row.agreement_version_id,
    agreementId: row.agreement_id,
    version: row.version,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    agreement: Object.assign(new AgreementEntity(), { id: row.agreement_id, key, type }),
  });
}

/**
 * Reads and writes over `agreements`, the family rows, and `agreement_versions`, their published
 * versions. Every method takes the caller's `EntityManager`, so a publish that also writes links
 * and audit rows keeps all of it in one transaction.
 */
export class AgreementsRepository {
  /**
   * Publishes the next version of a family: `1` when the family is new, `MAX(version) + 1`
   * otherwise. The family row is inserted only when `key` is new — an existing one is left
   * untouched and re-read, the same "insert, then re-read by the unique column" shape
   * `WorkflowsRepository.upsertFromFiles` uses for the same reason: `DO NOTHING` never trusts the
   * candidate id it just tried, because a concurrent insert may have won it first.
   *
   * The version itself is derived by the statement that inserts it, never read into JavaScript
   * and sent back, so nothing can act on a number that went stale between the read and the write.
   * Two concurrent publishes on one family can still derive the same number; the loser hits
   * `UNIQUE (agreement_id, version)` and the caller maps that violation to its conflict error
   * rather than this repository serializing publishes that almost never collide. The pointer is
   * set last, so `agreements.current_version_id` names the version this call just wrote as soon
   * as it resolves.
   */
  async createNextVersion(
    manager: EntityManager,
    key: string,
    type: AgreementType,
  ): Promise<AgreementVersionEntity> {
    await manager.query(
      `INSERT INTO agreements (id, key, type)
       VALUES ($1::uuid, $2::varchar, $3::varchar)
       ON CONFLICT ON CONSTRAINT uq_agreements_key DO NOTHING`,
      [generateUuidV7(), key, type],
    );

    const [{ id: agreementId, type: storedType }] = await manager.query<
      { id: string; type: AgreementType }[]
    >(`SELECT id, type FROM agreements WHERE key = $1::varchar`, [key]);

    const [version] = await manager.query<AgreementVersionRow[]>(
      `INSERT INTO agreement_versions (agreement_version_id, agreement_id, version, published_at)
       SELECT $1::uuid, $2::uuid, COALESCE(MAX(existing.version), 0) + 1, now()
         FROM agreement_versions existing
        WHERE existing.agreement_id = $2::uuid
       RETURNING agreement_version_id, agreement_id, version, published_at, created_at`,
      [generateUuidV7(), agreementId],
    );

    await manager.query(`UPDATE agreements SET current_version_id = $1::uuid WHERE id = $2::uuid`, [
      version.agreement_version_id,
      agreementId,
    ]);

    return toAgreementVersion(version, key, storedType);
  }

  /**
   * The family row for a key, or `undefined` when no family has ever published under it — what a
   * publish checks its requested `type` against. Reads `agreements` directly rather than through
   * `currentVersion`: that pointer is nullable (`ON DELETE SET NULL`), and a family whose pointer
   * is unset still has a stored, immutable `type` a new version must agree with.
   */
  async findFamilyByKey(manager: EntityManager, key: string): Promise<AgreementEntity | undefined> {
    const agreement = await manager.getRepository(AgreementEntity).findOne({ where: { key } });

    return agreement ?? undefined;
  }

  /**
   * The highest published version of each of several families, keyed by family. One statement for
   * the whole set: an onboarding start resolves every key its workflow declares at once rather
   * than paying a round trip per family. A key with nothing published is absent from the map, so
   * the caller can tell it apart and refuse the start.
   */
  async findLatestForKeys(
    manager: EntityManager,
    keys: readonly string[],
  ): Promise<Map<string, AgreementVersionEntity>> {
    if (keys.length === 0) {
      return new Map();
    }

    const rows = await manager.query<LatestAgreementVersionRow[]>(
      `SELECT agreement.key AS key,
              agreement.type AS type,
              version.agreement_version_id AS agreement_version_id,
              version.agreement_id AS agreement_id,
              version.version AS version,
              version.published_at AS published_at,
              version.created_at AS created_at
         FROM agreements agreement
         JOIN agreement_versions version ON version.agreement_version_id = agreement.current_version_id
        WHERE agreement.key = ANY($1::text[])`,
      [[...keys]],
    );

    return new Map(rows.map((row) => [row.key, toAgreementVersion(row, row.key, row.type)]));
  }

  /** One published version by its own id, or `undefined` when the id matches no row. */
  async findById(manager: EntityManager, id: string): Promise<AgreementVersionEntity | undefined> {
    const version = await manager.getRepository(AgreementVersionEntity).findOne({
      where: { agreementVersionId: id },
      relations: { agreement: true },
    });

    return version ?? undefined;
  }

  /**
   * Published versions for the admin listing, newest version first within a family. Both filters
   * are bound parameters, and the ordering is total so consecutive pages cannot overlap.
   */
  async findForAdmin(
    manager: EntityManager,
    filters?: AgreementListFilters,
  ): Promise<PaginatedResult<AgreementVersionEntity>> {
    const queryBuilder = manager
      .getRepository(AgreementVersionEntity)
      .createQueryBuilder('version')
      .innerJoinAndSelect('version.agreement', 'agreement');

    if (filters?.key !== undefined) {
      queryBuilder.andWhere('agreement.key = :key', { key: filters.key });
    }

    if (filters?.type !== undefined) {
      queryBuilder.andWhere('agreement.type = :type', { type: filters.type });
    }

    queryBuilder.orderBy('agreement.key', 'ASC').addOrderBy('version.version', 'DESC');

    return paginateQueryBuilder(queryBuilder, resolvePaginationWindow(filters));
  }
}
