import { EntityManager, In } from 'typeorm';
import { WorkflowEntity } from './entity/workflow.entity';
import type { WorkflowFile } from './workflow-file-loader.service';
import type { WorkflowScope } from './workflow-scope';

export class WorkflowsRepository {
  /**
   * Publishes file-sourced revisions into the table. `(workflow_id, version)` is
   * the natural key, so re-running startup never duplicates a revision; a
   * revision whose definition is unchanged is left untouched rather than
   * rewritten, which keeps `updated_at` meaningful.
   */
  async saveFiles(manager: EntityManager, files: readonly WorkflowFile[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    const parameters: unknown[] = [];
    const rows = files.map((file) => {
      parameters.push(file.workflowId, file.version, file.scope, JSON.stringify(file.definition));

      return `($${parameters.length - 3}, $${parameters.length - 2}, $${parameters.length - 1}, $${parameters.length}::json)`;
    });

    await manager.query(
      `INSERT INTO workflows (workflow_id, version, scope, definition)
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
