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
   * insert: a revision that was later moved to draft in the database stays a
   * draft instead of being republished by the next startup.
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
}
