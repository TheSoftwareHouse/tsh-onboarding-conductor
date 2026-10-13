import { EntityManager, In, Repository } from 'typeorm';
import { WorkflowConnectorSelectionEntity } from './entity/workflow-connector-selection.entity';
import { WorkflowConnectorSelectionsRepository } from './workflow-connector-selections.repository';

const WORKFLOW_ID = '0199f1c2-0000-7000-8000-000000000001';

describe('WorkflowConnectorSelectionsRepository', () => {
  const createHarness = () => {
    const entityRepositoryMock = {
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as Repository<WorkflowConnectorSelectionEntity>;
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      getRepository: jest.fn().mockReturnValue(entityRepositoryMock),
    } as unknown as EntityManager;

    return { sut: new WorkflowConnectorSelectionsRepository(), manager, entityRepositoryMock };
  };

  it('takes a transaction-scoped advisory lock keyed on the family and step', async () => {
    const harness = createHarness();

    await harness.sut.lock(harness.manager, WORKFLOW_ID, 'kyc');

    const [sql, parameters] = (harness.manager.query as jest.Mock).mock.calls[0];
    expect(sql).toContain('pg_advisory_xact_lock(hashtext($1))');
    expect(parameters).toEqual([`${WORKFLOW_ID}:kyc`]);
  });

  it('reads every selection of one family', async () => {
    const harness = createHarness();

    await harness.sut.findByWorkflowId(harness.manager, WORKFLOW_ID);

    expect(harness.manager.getRepository).toHaveBeenCalledWith(WorkflowConnectorSelectionEntity);
    expect(harness.entityRepositoryMock.find).toHaveBeenCalledWith({
      where: { workflowId: WORKFLOW_ID },
    });
  });

  it('reads every selection of one published version', async () => {
    const harness = createHarness();

    await harness.sut.findByVersion(harness.manager, WORKFLOW_ID, 2);

    expect(harness.entityRepositoryMock.find).toHaveBeenCalledWith({
      where: { workflowId: WORKFLOW_ID, version: 2 },
    });
  });

  it('reads one step selections across the given versions', async () => {
    const harness = createHarness();

    await harness.sut.findForStep(harness.manager, WORKFLOW_ID, 'kyc', [1, 2]);

    expect(harness.entityRepositoryMock.find).toHaveBeenCalledWith({
      where: { workflowId: WORKFLOW_ID, stepName: 'kyc', version: In([1, 2]) },
    });
  });

  it('reads every selection with its workflow family', async () => {
    const harness = createHarness();

    await harness.sut.findAll(harness.manager);

    expect(harness.entityRepositoryMock.find).toHaveBeenCalledWith({
      relations: { workflow: true },
    });
  });

  it('upserts on the primary key and re-stamps the connector, time and operator', async () => {
    const harness = createHarness();

    await harness.sut.upsert(harness.manager, WORKFLOW_ID, 2, 'kyc', 'veriff_kyc', 'operator-1');

    const [sql, parameters] = (harness.manager.query as jest.Mock).mock.calls[0];
    expect(sql).toContain('INSERT INTO workflow_connector_selections');
    expect(sql).toContain(
      '(workflow_id, version, step_name, connector_id, updated_at, updated_by)',
    );
    expect(sql).toContain('ON CONFLICT ON CONSTRAINT pk_workflow_connector_selections DO UPDATE');
    expect(sql).toContain('connector_id = EXCLUDED.connector_id');
    expect(sql).toContain('updated_by = EXCLUDED.updated_by');
    expect(parameters).toEqual([WORKFLOW_ID, 2, 'kyc', 'veriff_kyc', 'operator-1']);
  });

  it('deletes one step selection on the given versions and reports the rows removed', async () => {
    const harness = createHarness();
    (harness.entityRepositoryMock.delete as jest.Mock).mockResolvedValue({ affected: 2 });

    await expect(harness.sut.delete(harness.manager, WORKFLOW_ID, 'kyc', [1, 2])).resolves.toBe(2);

    expect(harness.entityRepositoryMock.delete).toHaveBeenCalledWith({
      workflowId: WORKFLOW_ID,
      stepName: 'kyc',
      version: In([1, 2]),
    });
  });

  it('reports zero when there was no row to delete', async () => {
    const harness = createHarness();
    (harness.entityRepositoryMock.delete as jest.Mock).mockResolvedValue({ affected: 0 });

    await expect(harness.sut.delete(harness.manager, WORKFLOW_ID, 'kyc', [1])).resolves.toBe(0);
  });
});
