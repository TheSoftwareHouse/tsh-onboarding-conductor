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

/** What the published-versions listing narrows on, beside the inherited `page`/`limit` window. */
export interface AgreementListFilters extends Partial<PaginationWindow> {
  key?: string;
  type?: AgreementType;
}

/** One `agreements` row as Postgres hands it back from a statement written by hand. */
interface AgreementRow {
  id: string;
  key: string;
  type: AgreementType;
  version: number;
  published_at: Date;
  created_at: Date;
}

function toAgreement(row: AgreementRow): AgreementEntity {
  return Object.assign(new AgreementEntity(), {
    id: row.id,
    key: row.key,
    type: row.type,
    version: row.version,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  });
}

/**
 * Reads and writes over `agreements`, the published versions of every family. Every method takes
 * the caller's `EntityManager`, so a publish that also writes links and audit rows keeps all of
 * it in one transaction.
 */
export class AgreementsRepository {
  /**
   * Publishes the next version of a family: `1` when the family is new, `MAX(version) + 1`
   * otherwise.
   *
   * The version is derived by the same statement that inserts it, never read into JavaScript and
   * sent back, so nothing can act on a number that went stale between the read and the write.
   * Two concurrent publishes on one family can still derive the same number; the loser hits
   * `UNIQUE (key, version)` and the caller maps that violation to its conflict error rather than
   * this repository serializing publishes that almost never collide.
   */
  async createNextVersion(
    manager: EntityManager,
    key: string,
    type: AgreementType,
  ): Promise<AgreementEntity> {
    const rows = await manager.query<AgreementRow[]>(
      `INSERT INTO agreements (id, key, type, version, published_at)
       SELECT $1::uuid, $2::varchar, $3::varchar, COALESCE(MAX(published.version), 0) + 1, now()
         FROM agreements published
        WHERE published.key = $2::varchar
       RETURNING id, key, type, version, published_at, created_at`,
      [generateUuidV7(), key, type],
    );

    return toAgreement(rows[0]);
  }

  /**
   * The highest published version of one family, or `undefined` when nothing has been published
   * under that key. The row also carries the family's `type`, which is constant across its
   * versions — that is what a publish compares against to reject a type that disagrees.
   */
  async findLatestByKey(manager: EntityManager, key: string): Promise<AgreementEntity | undefined> {
    const agreement = await manager.getRepository(AgreementEntity).findOne({
      where: { key },
      order: { version: 'DESC' },
    });

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
  ): Promise<Map<string, AgreementEntity>> {
    if (keys.length === 0) {
      return new Map();
    }

    const rows = await manager.query<AgreementRow[]>(
      `SELECT DISTINCT ON (key) id, key, type, version, published_at, created_at
         FROM agreements
        WHERE key = ANY($1::text[])
        ORDER BY key, version DESC`,
      [[...keys]],
    );

    return new Map(rows.map((row) => [row.key, toAgreement(row)]));
  }

  /** One published version by id, or `undefined` when the id matches no row. */
  async findById(manager: EntityManager, id: string): Promise<AgreementEntity | undefined> {
    const agreement = await manager.getRepository(AgreementEntity).findOne({ where: { id } });

    return agreement ?? undefined;
  }

  /**
   * Published versions for the admin listing, newest version first within a family. Both filters
   * are bound parameters, and the ordering is total so consecutive pages cannot overlap.
   */
  async findForAdmin(
    manager: EntityManager,
    filters?: AgreementListFilters,
  ): Promise<PaginatedResult<AgreementEntity>> {
    const queryBuilder = manager.getRepository(AgreementEntity).createQueryBuilder('agreement');

    if (filters?.key !== undefined) {
      queryBuilder.andWhere('agreement.key = :key', { key: filters.key });
    }

    if (filters?.type !== undefined) {
      queryBuilder.andWhere('agreement.type = :type', { type: filters.type });
    }

    queryBuilder.orderBy('agreement.key', 'ASC').addOrderBy('agreement.version', 'DESC');

    return paginateQueryBuilder(queryBuilder, resolvePaginationWindow(filters));
  }
}
