import { EntityManager, In, Repository } from 'typeorm';
import { WorkflowEntity } from './entity/workflow.entity';
import type { WorkflowFile } from './workflow-file-loader.service';
import type { WorkflowScope } from './workflow-scope';
import { WorkflowsRepository } from './workflows.repository';

const createWorkflowFile = (
  workflowId: string,
  version: number,
  scope: WorkflowScope,
): WorkflowFile => ({
  scope,
  filePath: `/workflows/${scope}/${workflowId}.workflow.json`,
  workflowId,
  version,
  definition: { id: workflowId, version },
});

describe('WorkflowsRepository', () => {
  const createHarness = () => {
    const entityRepositoryMock = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<WorkflowEntity>;
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      getRepository: jest.fn().mockReturnValue(entityRepositoryMock),
    } as unknown as EntityManager;

    return { sut: new WorkflowsRepository(), manager, entityRepositoryMock };
  };

  it('skips the query entirely when no file was discovered', async () => {
    const harness = createHarness();

    await harness.sut.saveFiles(harness.manager, []);

    expect(harness.manager.query).not.toHaveBeenCalled();
  });

  it('numbers the placeholders of every row and passes the definition as JSON', async () => {
    const harness = createHarness();

    await harness.sut.saveFiles(harness.manager, [
      createWorkflowFile('base', 1, 'fixtures'),
      createWorkflowFile('custom', 4, 'users'),
    ]);

    const [sql, parameters] = (harness.manager.query as jest.Mock).mock.calls[0];

    expect(sql).toContain('($1, $2, $3, $4::json), ($5, $6, $7, $8::json)');
    expect(parameters).toEqual([
      'base',
      1,
      'fixtures',
      JSON.stringify({ id: 'base', version: 1 }),
      'custom',
      4,
      'users',
      JSON.stringify({ id: 'custom', version: 4 }),
    ]);
  });

  it('resolves a conflicting revision in place instead of inserting a duplicate', async () => {
    const harness = createHarness();

    await harness.sut.saveFiles(harness.manager, [createWorkflowFile('base', 1, 'fixtures')]);

    const [sql] = (harness.manager.query as jest.Mock).mock.calls[0];

    expect(sql).toContain('ON CONFLICT ON CONSTRAINT pk_workflows DO UPDATE');
    expect(sql).toContain('workflows.definition::text IS DISTINCT FROM EXCLUDED.definition::text');
  });

  it('reads back only the requested scopes', async () => {
    const harness = createHarness();

    await harness.sut.findAll(harness.manager, ['built-in', 'users']);

    expect(harness.manager.getRepository).toHaveBeenCalledWith(WorkflowEntity);
    expect(harness.entityRepositoryMock.find).toHaveBeenCalledWith({
      where: { scope: In(['built-in', 'users']) },
      order: { workflowId: 'ASC', version: 'ASC' },
    });
  });
});
