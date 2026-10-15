import { EntityManager, In } from 'typeorm';
import { WorkflowConnectorSelectionEntity } from './entity/workflow-connector-selection.entity';

/** Moves the operator's per-step connector choices in and out of Postgres. */
export class WorkflowConnectorSelectionsRepository {
  /**
   * Serializes every read-modify-write on one step's selection for the rest of the calling
   * transaction. A row lock is not enough: the first selection for a step has no row to lock, so
   * an advisory lock keyed on the family and step covers that case too, and Postgres releases it
   * on commit or rollback.
   */
  async lock(manager: EntityManager, workflowId: string, stepName: string): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `${workflowId}:${stepName}`,
    ]);
  }

  /** Every selection of one workflow family — what a resolution applies to the definition. */
  async findByWorkflowId(
    manager: EntityManager,
    workflowId: string,
  ): Promise<WorkflowConnectorSelectionEntity[]> {
    return manager.getRepository(WorkflowConnectorSelectionEntity).find({ where: { workflowId } });
  }

  /** Every selection of one published version — what a resolution applies to its definition. */
  async findByVersion(
    manager: EntityManager,
    workflowId: string,
    version: number,
  ): Promise<WorkflowConnectorSelectionEntity[]> {
    return manager
      .getRepository(WorkflowConnectorSelectionEntity)
      .find({ where: { workflowId, version } });
  }

  /** The stored selections of one step on the given versions; a version with none is absent. */
  async findForStep(
    manager: EntityManager,
    workflowId: string,
    stepName: string,
    versions: number[],
  ): Promise<WorkflowConnectorSelectionEntity[]> {
    return manager
      .getRepository(WorkflowConnectorSelectionEntity)
      .find({ where: { workflowId, stepName, version: In(versions) } });
  }

  /** Every selection of every family, with the family loaded, for the boot sweep. */
  async findAll(manager: EntityManager): Promise<WorkflowConnectorSelectionEntity[]> {
    return manager
      .getRepository(WorkflowConnectorSelectionEntity)
      .find({ relations: { workflow: true } });
  }

  /** Stores the choice for a step on one version: inserts it the first time, replaces it after. */
  async upsert(
    manager: EntityManager,
    workflowId: string,
    version: number,
    stepName: string,
    connectorId: string,
    updatedBy: string | null,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO workflow_connector_selections (workflow_id, version, step_name, connector_id, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, now(), $5)
       ON CONFLICT ON CONSTRAINT pk_workflow_connector_selections DO UPDATE
         SET connector_id = EXCLUDED.connector_id,
             updated_at = now(),
             updated_by = EXCLUDED.updated_by`,
      [workflowId, version, stepName, connectorId, updatedBy],
    );
  }

  /** Drops the choice on the given versions, returning them to the authored connector; rows removed. */
  async delete(
    manager: EntityManager,
    workflowId: string,
    stepName: string,
    versions: number[],
  ): Promise<number> {
    const result = await manager
      .getRepository(WorkflowConnectorSelectionEntity)
      .delete({ workflowId, stepName, version: In(versions) });

    return result.affected ?? 0;
  }
}
