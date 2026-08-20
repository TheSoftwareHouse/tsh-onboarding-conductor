import { EntityManager, In } from 'typeorm';
import { WorkflowEntity } from './entity/workflow.entity';
import type { WorkflowFile } from './workflow-file-loader.service';
import type { WorkflowScope } from './workflow-scope';
import { PUBLISHED_WORKFLOW_STATUS } from './workflow-status';

export class WorkflowsRepository {
  /**
   * Publishes file-sourced revisions into the table. `(workflow_id, version)` is
   * the natural key, so re-running startup never duplicates a revision; a
   * revision whose definition is unchanged is left untouched rather than
   * rewritten, which keeps `updated_at` meaningful. `status` is only set on
   * insert: a revision that was later moved to draft or retired in the database
   * keeps that status instead of being republished by the next startup.
   */
  async upsertFromFiles(manager: EntityManager, files: readonly WorkflowFile[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    const parameters: unknown[] = [];
    const rows = files.map((file) => {
      const firstIndex = parameters.length + 1;
      parameters.push(
        file.workflowId,
        file.version,
        file.scope,
        PUBLISHED_WORKFLOW_STATUS,
        JSON.stringify(file.definition),
      );

      return `($${firstIndex}, $${firstIndex + 1}, $${firstIndex + 2}, $${firstIndex + 3}, $${firstIndex + 4}::json)`;
    });

    await manager.query(
      `INSERT INTO workflows (workflow_id, version, scope, status, definition)
       VALUES ${rows.join(', ')}
       ON CONFLICT ON CONSTRAINT pk_workflows DO UPDATE
         SET scope = EXCLUDED.scope,
             definition = EXCLUDED.definition,
             updated_at = now()
       WHERE workflows.scope IS DISTINCT FROM EXCLUDED.scope
          OR workflows.definition::text IS DISTINCT FROM EXCLUDED.definition::text`,
      parameters,
    );
  }

  /** Returns every revision, drafts included: a pinned lookup must resolve them. */
  async findAll(
    manager: EntityManager,
    scopes: readonly WorkflowScope[],
  ): Promise<WorkflowEntity[]> {
    return manager.getRepository(WorkflowEntity).find({
      where: { scope: In([...scopes]) },
      order: { workflowId: 'ASC', version: 'ASC' },
    });
  }

  /**
   * Resolves one pinned revision whatever its status. The caller decides what a
   * draft or a retired revision means; the repository only reports what is stored.
   */
  async findRevision(
    manager: EntityManager,
    scopes: readonly WorkflowScope[],
    workflowId: string,
    version: number,
  ): Promise<WorkflowEntity | null> {
    return manager.getRepository(WorkflowEntity).findOne({
      where: { workflowId, version, scope: In([...scopes]) },
    });
  }

  /** The revision an unpinned start resolves to: the highest published one. */
  async findLatestPublished(
    manager: EntityManager,
    scopes: readonly WorkflowScope[],
    workflowId: string,
  ): Promise<WorkflowEntity | null> {
    return manager.getRepository(WorkflowEntity).findOne({
      where: { workflowId, scope: In([...scopes]), status: PUBLISHED_WORKFLOW_STATUS },
      order: { version: 'DESC' },
    });
  }

  /**
   * Whether the id exists at all, at any version and any status. Separates "no
   * such workflow" from "no such version of it" without loading definitions.
   */
  async countRevisions(
    manager: EntityManager,
    scopes: readonly WorkflowScope[],
    workflowId: string,
  ): Promise<number> {
    return manager.getRepository(WorkflowEntity).count({
      where: { workflowId, scope: In([...scopes]) },
    });
  }

  /** Startup diagnostics only: whether any workflow at all can be started. */
  async countPublished(manager: EntityManager, scopes: readonly WorkflowScope[]): Promise<number> {
    return manager.getRepository(WorkflowEntity).count({
      where: { scope: In([...scopes]), status: PUBLISHED_WORKFLOW_STATUS },
    });
  }
}
