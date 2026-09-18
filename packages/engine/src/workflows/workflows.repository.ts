import { EntityManager, In } from 'typeorm';
import { generateUuidV7 } from '../utils/uuid.util';
import { WorkflowVersionEntity } from './entity/workflow-version.entity';
import type { WorkflowFile } from './workflow-file-loader.service';
import type { WorkflowScope } from './workflow-scope';
import { PUBLISHED_WORKFLOW_STATUS } from './workflow-status';

/** One `workflows` row as Postgres hands it back from the identity lookup upsert reads. */
interface WorkflowIdentityRow {
  workflow_id: string;
  name: string;
}

export class WorkflowsRepository {
  /**
   * Publishes file-sourced revisions into the two tables. The identity row is upserted first,
   * keyed by `name`: a name seen for the first time is given a freshly generated uuid, and a name
   * that already has a row keeps the `workflow_id` it already has, so every revision of it keeps
   * pointing at the same parent. The version rows are then upserted keyed on
   * `uq_workflow_versions_workflow_version`, exactly as the single-table upsert this replaces
   * behaved: `status` is only set on insert, and a revision whose `scope` and `definition` are
   * unchanged is left untouched so `updated_at` stays meaningful.
   */
  async upsertFromFiles(manager: EntityManager, files: readonly WorkflowFile[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    const names = [...new Set(files.map((file) => file.workflowId))];
    const identityParameters: unknown[] = [];
    const identityRows = names.map((name) => {
      const firstIndex = identityParameters.length + 1;
      identityParameters.push(generateUuidV7(), name);

      return `($${firstIndex}, $${firstIndex + 1})`;
    });

    await manager.query(
      `INSERT INTO workflows (workflow_id, name)
       VALUES ${identityRows.join(', ')}
       ON CONFLICT ON CONSTRAINT uq_workflows_name DO NOTHING`,
      identityParameters,
    );

    // Re-read rather than trust the candidate ids just inserted: a name that already had a row
    // left its `workflow_id` untouched by the `DO NOTHING` above, and this is the only way to
    // learn which id — the candidate or the pre-existing one — is the row's real parent.
    const identityRowsResult = await manager.query<WorkflowIdentityRow[]>(
      `SELECT workflow_id, name FROM workflows WHERE name = ANY($1::varchar[])`,
      [names],
    );
    const workflowIdByName = new Map(identityRowsResult.map((row) => [row.name, row.workflow_id]));

    const versionParameters: unknown[] = [];
    const versionRows = files.map((file) => {
      const firstIndex = versionParameters.length + 1;
      versionParameters.push(
        generateUuidV7(),
        workflowIdByName.get(file.workflowId),
        file.version,
        file.scope,
        PUBLISHED_WORKFLOW_STATUS,
        JSON.stringify(file.definition),
      );

      return `($${firstIndex}, $${firstIndex + 1}, $${firstIndex + 2}, $${firstIndex + 3}, $${firstIndex + 4}, $${firstIndex + 5}::json)`;
    });

    await manager.query(
      `INSERT INTO workflow_versions (workflow_version_id, workflow_id, version, scope, status, definition)
       VALUES ${versionRows.join(', ')}
       ON CONFLICT ON CONSTRAINT uq_workflow_versions_workflow_version DO UPDATE
         SET scope = EXCLUDED.scope,
             definition = EXCLUDED.definition,
             updated_at = now()
       WHERE workflow_versions.scope IS DISTINCT FROM EXCLUDED.scope
          OR workflow_versions.definition::text IS DISTINCT FROM EXCLUDED.definition::text`,
      versionParameters,
    );
  }

  /** Returns every revision, drafts included: a pinned lookup must resolve them. */
  async findAll(
    manager: EntityManager,
    scopes: readonly WorkflowScope[],
  ): Promise<WorkflowVersionEntity[]> {
    return manager.getRepository(WorkflowVersionEntity).find({
      where: { scope: In([...scopes]) },
      relations: { workflow: true },
      order: { workflow: { name: 'ASC' }, version: 'ASC' },
    });
  }

  /**
   * Resolves one pinned revision whatever its status. The caller decides what a
   * draft or a retired revision means; the repository only reports what is stored.
   */
  async findRevision(
    manager: EntityManager,
    scopes: readonly WorkflowScope[],
    name: string,
    version: number,
  ): Promise<WorkflowVersionEntity | null> {
    return manager.getRepository(WorkflowVersionEntity).findOne({
      where: { workflow: { name }, version, scope: In([...scopes]) },
      relations: { workflow: true },
    });
  }

  /** The revision an unpinned start resolves to: the highest published one. */
  async findLatestPublished(
    manager: EntityManager,
    scopes: readonly WorkflowScope[],
    name: string,
  ): Promise<WorkflowVersionEntity | null> {
    return manager.getRepository(WorkflowVersionEntity).findOne({
      where: { workflow: { name }, scope: In([...scopes]), status: PUBLISHED_WORKFLOW_STATUS },
      relations: { workflow: true },
      order: { version: 'DESC' },
    });
  }

  /**
   * Whether the name exists at all, at any version and any status. Separates "no
   * such workflow" from "no such version of it" without loading definitions.
   */
  async countRevisions(
    manager: EntityManager,
    scopes: readonly WorkflowScope[],
    name: string,
  ): Promise<number> {
    return manager.getRepository(WorkflowVersionEntity).count({
      where: { workflow: { name }, scope: In([...scopes]) },
    });
  }

  /** Startup diagnostics only: whether any workflow at all can be started. */
  async countPublished(manager: EntityManager, scopes: readonly WorkflowScope[]): Promise<number> {
    return manager.getRepository(WorkflowVersionEntity).count({
      where: { scope: In([...scopes]), status: PUBLISHED_WORKFLOW_STATUS },
    });
  }

  /** One stored revision by its own uuid, whatever its status — every in-flight path holds it. */
  async findVersionById(
    manager: EntityManager,
    scopes: readonly WorkflowScope[],
    workflowVersionId: string,
  ): Promise<WorkflowVersionEntity | null> {
    return manager.getRepository(WorkflowVersionEntity).findOne({
      where: { workflowVersionId, scope: In([...scopes]) },
      relations: { workflow: true },
    });
  }
}
