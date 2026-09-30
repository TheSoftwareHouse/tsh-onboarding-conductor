import { EntityManager, In } from 'typeorm';
import { countTotalPages, resolvePaginationWindow, type PaginatedResult } from '../pagination';
import { generateUuidV7 } from '../utils/uuid.util';
import type { ListAdminWorkflowsQueryDto } from './dto/list-admin-workflows.query.dto';
import { WorkflowVersionEntity } from './entity/workflow-version.entity';
import { WorkflowScopeConflictError } from './errors/workflow-scope-conflict.error';
import { WorkflowVersionConflictError } from './errors/workflow-version-conflict.error';
import type { WorkflowFile } from './workflow-file-loader.service';
import type { WorkflowScope } from './workflow-scope';
import { DRAFT_WORKFLOW_STATUS, PUBLISHED_WORKFLOW_STATUS } from './workflow-status';

/** One `workflows` row as Postgres hands it back from the identity read. */
interface WorkflowIdentityRow {
  workflow_id: string;
  key: string;
  scope: WorkflowScope;
}

/** One stored revision as the pre-publish read returns it: what a file is held against. */
interface StoredRevisionRow {
  workflow_id: string;
  version: number;
  definition: Record<string, unknown> | string;
}

/**
 * The comparison form of a definition. The column is `json`, which keeps the authored text, so two
 * documents are the same definition when they serialize the same — and a row the driver hands back
 * already parsed lands on the same string as one it hands back as text.
 */
const canonicalJson = (definition: Record<string, unknown> | string): string =>
  JSON.stringify(typeof definition === 'string' ? JSON.parse(definition) : definition);

const revisionKey = (workflowId: string, version: number): string => `${workflowId}@${version}`;

/** One workflow family with its computed counts, as the admin list reports it. */
export interface AdminWorkflowListRow {
  workflowId: string;
  name: string | null;
  scope: WorkflowScope;
  servingVersion: number | null;
  versionCount: number;
  draftCount: number;
  inProgressCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** The raw shape Postgres hands back, before its `bigint` counts are coerced to `number`. */
interface AdminWorkflowRawRow {
  workflow_id: string;
  name: string | null;
  scope: WorkflowScope;
  serving_version: number | null;
  version_count: string;
  draft_count: string;
  in_progress_count: string;
  created_at: Date;
  updated_at: Date;
}

// Escapes the wildcards a raw `LIKE`/`ILIKE` pattern would otherwise read from the caller's text.
const escapeLikeValue = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** The `WHERE` predicate shared by the page query and its count, so the two never diverge. */
const buildAdminWorkflowsPredicate = (
  scopes: readonly WorkflowScope[],
  filters: ListAdminWorkflowsQueryDto,
): [predicate: string, parameters: unknown[]] => {
  const parameters: unknown[] = [scopes];
  const conditions = ['w.scope = ANY($1::varchar[])'];

  if (filters.search !== undefined) {
    parameters.push(`%${escapeLikeValue(filters.search)}%`);
    conditions.push(
      `(w.key ILIKE $${parameters.length} ESCAPE '\\' OR w.name ILIKE $${parameters.length} ESCAPE '\\')`,
    );
  }

  if (filters.scope !== undefined) {
    parameters.push(filters.scope);
    conditions.push(`w.scope = $${parameters.length}`);
  }

  if (filters.hasDraft === true) {
    parameters.push(DRAFT_WORKFLOW_STATUS);
    conditions.push(
      `EXISTS (SELECT 1 FROM workflow_versions dv WHERE dv.workflow_id = w.workflow_id AND dv.status = $${parameters.length})`,
    );
  }

  return [conditions.join(' AND '), parameters];
};

const mapAdminWorkflowRow = (row: AdminWorkflowRawRow): AdminWorkflowListRow => ({
  workflowId: row.workflow_id,
  name: row.name,
  scope: row.scope,
  servingVersion: row.serving_version,
  versionCount: Number(row.version_count),
  draftCount: Number(row.draft_count),
  inProgressCount: Number(row.in_progress_count),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const getIdentity = (
  identityByKey: ReadonlyMap<string, WorkflowIdentityRow>,
  key: string,
): WorkflowIdentityRow => {
  const identity = identityByKey.get(key);

  if (identity === undefined) {
    throw new Error(`Workflow identity row for "${key}" is missing right after its upsert`);
  }

  return identity;
};

export class WorkflowsRepository {
  /**
   * Publishes file-sourced revisions into the two tables, in one transaction. The identity row is
   * upserted first, keyed by `key`: a key seen for the first time is given a freshly generated uuid
   * and the scope of the file that declares it, and a key that already has a row keeps the
   * `workflow_id` and the scope it already has, so every revision of it keeps pointing at the same
   * parent. A family belongs to one scope, so a file whose scope is not the stored family's is
   * refused with `WorkflowScopeConflictError` before any revision is looked at. A revision is then
   * stored once and never rewritten: a file whose `(key, version)` is already stored is left alone
   * when its definition matches the row, and refused with `WorkflowVersionConflictError` when it
   * differs — a stored version is immutable, so a change ships as the next version. `status` is set
   * on insert alone, so a revision moved off `published` in the database stays there. Finally the
   * family's `name` takes the label of the highest stored version that declares one.
   */
  async publishFromFiles(manager: EntityManager, files: readonly WorkflowFile[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    await manager.transaction(async (transaction) => {
      const identityByKey = await this.upsertIdentities(transaction, files);

      for (const file of files) {
        const identity = getIdentity(identityByKey, file.workflowId);

        if (identity.scope !== file.scope) {
          throw new WorkflowScopeConflictError(file, { scope: identity.scope });
        }
      }

      const storedRevisions = await this.findStoredRevisions(
        transaction,
        [...identityByKey.values()].map((identity) => identity.workflow_id),
      );
      const newFiles = files.filter((file) => {
        const stored = storedRevisions.get(
          revisionKey(getIdentity(identityByKey, file.workflowId).workflow_id, file.version),
        );

        if (stored === undefined) {
          return true;
        }

        this.assertUnchanged(file, stored);

        return false;
      });

      if (newFiles.length === 0) {
        return;
      }

      await this.insertRevisions(transaction, newFiles, identityByKey);
      await this.updateLabels(transaction, newFiles, identityByKey, storedRevisions);
    });
  }

  /** Returns every revision, drafts included: a pinned lookup must resolve them. */
  async findAll(
    manager: EntityManager,
    scopes: readonly WorkflowScope[],
  ): Promise<WorkflowVersionEntity[]> {
    return manager.getRepository(WorkflowVersionEntity).find({
      where: { workflow: { scope: In([...scopes]) } },
      relations: { workflow: true },
      order: { workflow: { key: 'ASC' }, version: 'ASC' },
    });
  }

  /**
   * Resolves one pinned revision whatever its status. The caller decides what a
   * draft or a retired revision means; the repository only reports what is stored.
   */
  async findRevision(
    manager: EntityManager,
    scopes: readonly WorkflowScope[],
    key: string,
    version: number,
  ): Promise<WorkflowVersionEntity | null> {
    return manager.getRepository(WorkflowVersionEntity).findOne({
      where: { workflow: { key, scope: In([...scopes]) }, version },
      relations: { workflow: true },
    });
  }

  /** The revision an unpinned start resolves to: the highest published one. */
  async findLatestPublished(
    manager: EntityManager,
    scopes: readonly WorkflowScope[],
    key: string,
  ): Promise<WorkflowVersionEntity | null> {
    return manager.getRepository(WorkflowVersionEntity).findOne({
      where: { workflow: { key, scope: In([...scopes]) }, status: PUBLISHED_WORKFLOW_STATUS },
      relations: { workflow: true },
      order: { version: 'DESC' },
    });
  }

  /**
   * Whether the key exists at all, at any version and any status. Separates "no
   * such workflow" from "no such version of it" without loading definitions.
   */
  async countRevisions(
    manager: EntityManager,
    scopes: readonly WorkflowScope[],
    key: string,
  ): Promise<number> {
    return manager.getRepository(WorkflowVersionEntity).count({
      where: { workflow: { key, scope: In([...scopes]) } },
    });
  }

  /** Startup diagnostics only: whether any workflow at all can be started. */
  async countPublished(manager: EntityManager, scopes: readonly WorkflowScope[]): Promise<number> {
    return manager.getRepository(WorkflowVersionEntity).count({
      where: { workflow: { scope: In([...scopes]) }, status: PUBLISHED_WORKFLOW_STATUS },
    });
  }

  /** One stored revision by its own uuid, whatever its status — every in-flight path holds it. */
  async findVersionById(
    manager: EntityManager,
    scopes: readonly WorkflowScope[],
    workflowVersionId: string,
  ): Promise<WorkflowVersionEntity | null> {
    return manager.getRepository(WorkflowVersionEntity).findOne({
      where: { workflowVersionId, workflow: { scope: In([...scopes]) } },
      relations: { workflow: true },
    });
  }

  /** One page of workflow families in the given scopes, with their computed counts. */
  async listForAdmin(
    manager: EntityManager,
    scopes: readonly WorkflowScope[],
    filters: ListAdminWorkflowsQueryDto,
  ): Promise<PaginatedResult<AdminWorkflowListRow>> {
    const { page, limit } = resolvePaginationWindow(filters);
    const [predicate, predicateParameters] = buildAdminWorkflowsPredicate(scopes, filters);

    const [{ total }] = await manager.query<{ total: string }[]>(
      `SELECT count(*) AS total FROM workflows w WHERE ${predicate}`,
      predicateParameters,
    );

    const pageParameters = [
      ...predicateParameters,
      PUBLISHED_WORKFLOW_STATUS,
      DRAFT_WORKFLOW_STATUS,
      limit,
      (page - 1) * limit,
    ];
    const publishedIndex = predicateParameters.length + 1;
    const draftIndex = predicateParameters.length + 2;
    const limitIndex = predicateParameters.length + 3;
    const offsetIndex = predicateParameters.length + 4;
    const rows = await manager.query<AdminWorkflowRawRow[]>(
      `SELECT w.key AS workflow_id,
              w.name AS name,
              w.scope AS scope,
              MAX(CASE WHEN wv.status = $${publishedIndex} THEN wv.version END) AS serving_version,
              count(DISTINCT wv.workflow_version_id) AS version_count,
              count(DISTINCT wv.workflow_version_id) FILTER (WHERE wv.status = $${draftIndex}) AS draft_count,
              count(o.id) AS in_progress_count,
              w.created_at AS created_at,
              w.updated_at AS updated_at
         FROM workflows w
         LEFT JOIN workflow_versions wv ON wv.workflow_id = w.workflow_id
         -- In the join, not the count, so it matches idx_onboardings_in_progress_version's predicate.
         LEFT JOIN onboardings o
           ON o.workflow_version_id = wv.workflow_version_id AND o.completed_at IS NULL
        WHERE ${predicate}
        GROUP BY w.workflow_id
        ORDER BY w.key ASC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      pageParameters,
    );

    const totalCount = Number(total ?? 0);

    return {
      items: rows.map(mapAdminWorkflowRow),
      total: totalCount,
      page,
      limit,
      totalPages: countTotalPages(totalCount, limit),
    };
  }

  private async upsertIdentities(
    manager: EntityManager,
    files: readonly WorkflowFile[],
  ): Promise<Map<string, WorkflowIdentityRow>> {
    // The first file declaring a key sets the scope a new family is created with; the loader has
    // already refused a boot where two scope directories declare one key.
    const scopeByKey = new Map<string, WorkflowScope>();

    for (const file of files) {
      if (!scopeByKey.has(file.workflowId)) {
        scopeByKey.set(file.workflowId, file.scope);
      }
    }

    const parameters: unknown[] = [];
    const rows = [...scopeByKey].map(([key, scope]) => {
      const firstIndex = parameters.length + 1;
      parameters.push(generateUuidV7(), key, scope);

      return `($${firstIndex}, $${firstIndex + 1}, $${firstIndex + 2})`;
    });

    await manager.query(
      `INSERT INTO workflows (workflow_id, key, scope)
       VALUES ${rows.join(', ')}
       ON CONFLICT ON CONSTRAINT uq_workflows_key DO NOTHING`,
      parameters,
    );

    // Re-read rather than trust the candidate rows just inserted: a key that already had a row
    // left its `workflow_id` and `scope` untouched by the `DO NOTHING` above, and this is the only
    // way to learn which id — the candidate or the pre-existing one — is the row's real parent,
    // and which scope the family actually belongs to.
    const identityRows = await manager.query<WorkflowIdentityRow[]>(
      `SELECT workflow_id, key, scope FROM workflows WHERE key = ANY($1::varchar[])`,
      [[...scopeByKey.keys()]],
    );

    return new Map(identityRows.map((row) => [row.key, row]));
  }

  private async findStoredRevisions(
    manager: EntityManager,
    workflowIds: readonly string[],
  ): Promise<Map<string, StoredRevisionRow>> {
    const rows = await manager.query<StoredRevisionRow[]>(
      `SELECT workflow_id, version, definition
         FROM workflow_versions
        WHERE workflow_id = ANY($1::uuid[])`,
      [workflowIds],
    );

    return new Map(rows.map((row) => [revisionKey(row.workflow_id, row.version), row]));
  }

  private assertUnchanged(file: WorkflowFile, stored: StoredRevisionRow): void {
    if (canonicalJson(stored.definition) !== canonicalJson(file.definition)) {
      throw new WorkflowVersionConflictError(file);
    }
  }

  private async insertRevisions(
    manager: EntityManager,
    files: readonly WorkflowFile[],
    identityByKey: ReadonlyMap<string, WorkflowIdentityRow>,
  ): Promise<void> {
    const parameters: unknown[] = [];
    const rows = files.map((file) => {
      const firstIndex = parameters.length + 1;
      parameters.push(
        generateUuidV7(),
        getIdentity(identityByKey, file.workflowId).workflow_id,
        file.version,
        PUBLISHED_WORKFLOW_STATUS,
        JSON.stringify(file.definition),
      );

      return `($${firstIndex}, $${firstIndex + 1}, $${firstIndex + 2}, $${firstIndex + 3}, $${firstIndex + 4}::json)`;
    });

    // `DO NOTHING` rather than a bare insert: two engine instances booting together both find a
    // revision missing and both insert it, and the second must not fail its boot over a row
    // identical to the one it meant to write.
    await manager.query(
      `INSERT INTO workflow_versions (workflow_version_id, workflow_id, version, status, definition)
       VALUES ${rows.join(', ')}
       ON CONFLICT ON CONSTRAINT uq_workflow_versions_workflow_version DO NOTHING`,
      parameters,
    );
  }

  /**
   * The family label follows the highest stored version that declares one, whichever boot stored
   * it: a version stored now sets it only when no revision already stored outranks it, and a
   * document without a root `name` leaves whatever label the family already carries.
   */
  private async updateLabels(
    manager: EntityManager,
    files: readonly WorkflowFile[],
    identityByKey: ReadonlyMap<string, WorkflowIdentityRow>,
    storedRevisions: ReadonlyMap<string, StoredRevisionRow>,
  ): Promise<void> {
    const highestStoredVersion = new Map<string, number>();

    for (const stored of storedRevisions.values()) {
      highestStoredVersion.set(
        stored.workflow_id,
        Math.max(stored.version, highestStoredVersion.get(stored.workflow_id) ?? 0),
      );
    }

    const labelByWorkflowId = new Map<string, string>();

    for (const file of [...files].sort((left, right) => left.version - right.version)) {
      const workflowId = getIdentity(identityByKey, file.workflowId).workflow_id;

      if (file.name !== undefined && file.version > (highestStoredVersion.get(workflowId) ?? 0)) {
        labelByWorkflowId.set(workflowId, file.name);
      }
    }

    if (labelByWorkflowId.size === 0) {
      return;
    }

    const parameters: unknown[] = [];
    const rows = [...labelByWorkflowId].map(([workflowId, name]) => {
      const firstIndex = parameters.length + 1;
      parameters.push(workflowId, name);

      return `($${firstIndex}::uuid, $${firstIndex + 1}::varchar)`;
    });

    await manager.query(
      `UPDATE workflows
          SET name = labels.name, updated_at = now()
         FROM (VALUES ${rows.join(', ')}) AS labels (workflow_id, name)
        WHERE workflows.workflow_id = labels.workflow_id
          AND workflows.name IS DISTINCT FROM labels.name`,
      parameters,
    );
  }
}
