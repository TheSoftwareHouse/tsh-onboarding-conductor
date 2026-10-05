import { EntityManager } from 'typeorm';
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

  /** The stored selection of one step, or `null` when the step runs its authored connector. */
  async find(
    manager: EntityManager,
    workflowId: string,
    stepName: string,
  ): Promise<WorkflowConnectorSelectionEntity | null> {
    return manager
      .getRepository(WorkflowConnectorSelectionEntity)
      .findOne({ where: { workflowId, stepName } });
  }

  /** Every selection of every family, with the family loaded, for the boot sweep. */
  async findAll(manager: EntityManager): Promise<WorkflowConnectorSelectionEntity[]> {
    return manager
      .getRepository(WorkflowConnectorSelectionEntity)
      .find({ relations: { workflow: true } });
  }

  /** Stores the choice for a step: inserts it the first time, replaces the connector after. */
  async upsert(
    manager: EntityManager,
    workflowId: string,
    stepName: string,
    connectorId: string,
    updatedBy: string | null,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO workflow_connector_selections (workflow_id, step_name, connector_id, updated_at, updated_by)
       VALUES ($1, $2, $3, now(), $4)
       ON CONFLICT ON CONSTRAINT pk_workflow_connector_selections DO UPDATE
         SET connector_id = EXCLUDED.connector_id,
             updated_at = now(),
             updated_by = EXCLUDED.updated_by`,
      [workflowId, stepName, connectorId, updatedBy],
    );
  }

  /** Drops the choice, returning the step to its authored connector; whether a row existed. */
  async delete(manager: EntityManager, workflowId: string, stepName: string): Promise<boolean> {
    const result = await manager
      .getRepository(WorkflowConnectorSelectionEntity)
      .delete({ workflowId, stepName });

    return (result.affected ?? 0) > 0;
  }
}
