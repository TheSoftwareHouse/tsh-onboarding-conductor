import { EntityManager, In, Repository } from 'typeorm';
import { generateUuidV7 } from '../utils/uuid.util';
import { WorkflowVersionEntity } from './entity/workflow-version.entity';
import type { WorkflowFile } from './workflow-file-loader.service';
import type { WorkflowScope } from './workflow-scope';
import { WorkflowsRepository } from './workflows.repository';

jest.mock('../utils/uuid.util');

const mockGenerateUuidV7 = generateUuidV7 as jest.Mock;

type WorkflowIdentityRow = { workflow_id: string; name: string };

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
  const createHarness = (identityRows: WorkflowIdentityRow[] = []) => {
    const entityRepositoryMock = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    } as unknown as Repository<WorkflowVersionEntity>;
    const query = jest
      .fn()
      .mockImplementation((sql: string) =>
        Promise.resolve(
          sql.includes('SELECT workflow_id, name FROM workflows') ? identityRows : undefined,
        ),
      );
    const manager = {
      query,
      getRepository: jest.fn().mockReturnValue(entityRepositoryMock),
    } as unknown as EntityManager;

    return { sut: new WorkflowsRepository(), manager, entityRepositoryMock };
  };

  it('skips the query entirely when no file was discovered', async () => {
    const harness = createHarness();

    await harness.sut.upsertFromFiles(harness.manager, []);

    expect(harness.manager.query).not.toHaveBeenCalled();
  });

  it('numbers the placeholders of every row and passes the definition as JSON', async () => {
    mockGenerateUuidV7
      .mockReturnValueOnce('candidate-base')
      .mockReturnValueOnce('candidate-custom')
      .mockReturnValueOnce('version-base-1')
      .mockReturnValueOnce('version-custom-4');
    const harness = createHarness([
      { workflow_id: 'wf-base', name: 'base' },
      { workflow_id: 'wf-custom', name: 'custom' },
    ]);

    await harness.sut.upsertFromFiles(harness.manager, [
      createWorkflowFile('base', 1, 'fixtures'),
      createWorkflowFile('custom', 4, 'users'),
    ]);

    const calls = (harness.manager.query as jest.Mock).mock.calls;
    expect(calls).toHaveLength(3);

    const [identitySql, identityParameters] = calls[0];
    expect(identitySql).toContain('($1, $2), ($3, $4)');
    expect(identitySql).toContain('ON CONFLICT ON CONSTRAINT uq_workflows_name DO NOTHING');
    expect(identityParameters).toEqual(['candidate-base', 'base', 'candidate-custom', 'custom']);

    const [selectSql, selectParameters] = calls[1];
    expect(selectSql).toContain('SELECT workflow_id, name FROM workflows');
    expect(selectParameters).toEqual([['base', 'custom']]);

    const [versionSql, versionParameters] = calls[2];
    expect(versionSql).toContain(
      '($1, $2, $3, $4, $5, $6::json), ($7, $8, $9, $10, $11, $12::json)',
    );
    expect(versionParameters).toEqual([
      'version-base-1',
      'wf-base',
      1,
      'fixtures',
      'published',
      JSON.stringify({ id: 'base', version: 1 }),
      'version-custom-4',
      'wf-custom',
      4,
      'users',
      'published',
      JSON.stringify({ id: 'custom', version: 4 }),
    ]);
  });

  it('reuses the existing parent row across two revisions of the same name rather than inserting another one', async () => {
    mockGenerateUuidV7
      .mockReturnValueOnce('candidate-base')
      .mockReturnValueOnce('version-base-1')
      .mockReturnValueOnce('version-base-2');
    // The identity read reports the row's real, already-stored id, distinct from the freshly
    // generated candidate the insert attempted — exactly what `ON CONFLICT ... DO NOTHING` leaves
    // behind when the name already had a parent.
    const harness = createHarness([{ workflow_id: 'existing-wf-base', name: 'base' }]);

    await harness.sut.upsertFromFiles(harness.manager, [
      createWorkflowFile('base', 1, 'fixtures'),
      createWorkflowFile('base', 2, 'fixtures'),
    ]);

    const calls = (harness.manager.query as jest.Mock).mock.calls;
    const [identitySql, identityParameters] = calls[0];
    expect(identitySql).toContain('($1, $2)');
    expect(identitySql).not.toContain('$3');
    expect(identityParameters).toEqual(['candidate-base', 'base']);

    const [, versionParameters] = calls[2];
    expect(versionParameters).toEqual([
      'version-base-1',
      'existing-wf-base',
      1,
      'fixtures',
      'published',
      JSON.stringify({ id: 'base', version: 1 }),
      'version-base-2',
      'existing-wf-base',
      2,
      'fixtures',
      'published',
      JSON.stringify({ id: 'base', version: 2 }),
    ]);
  });

  it('resolves a conflicting revision in place instead of inserting a duplicate', async () => {
    const harness = createHarness([{ workflow_id: 'wf-base', name: 'base' }]);

    await harness.sut.upsertFromFiles(harness.manager, [createWorkflowFile('base', 1, 'fixtures')]);

    const [, , [versionSql]] = (harness.manager.query as jest.Mock).mock.calls;

    expect(versionSql).toContain(
      'ON CONFLICT ON CONSTRAINT uq_workflow_versions_workflow_version DO UPDATE',
    );
    expect(versionSql).toContain(
      'workflow_versions.definition::text IS DISTINCT FROM EXCLUDED.definition::text',
    );
  });

  it('never rewrites the status of a revision that is already stored', async () => {
    const harness = createHarness([{ workflow_id: 'wf-base', name: 'base' }]);

    await harness.sut.upsertFromFiles(harness.manager, [createWorkflowFile('base', 1, 'fixtures')]);

    const [, , [versionSql]] = (harness.manager.query as jest.Mock).mock.calls;

    expect(versionSql).toContain('SET scope = EXCLUDED.scope');
    expect(versionSql).not.toContain('status = EXCLUDED.status');
  });

  it('reads back only the requested scopes', async () => {
    const harness = createHarness();

    await harness.sut.findAll(harness.manager, ['built-in', 'users']);

    expect(harness.manager.getRepository).toHaveBeenCalledWith(WorkflowVersionEntity);
    expect(harness.entityRepositoryMock.find).toHaveBeenCalledWith({
      where: { scope: In(['built-in', 'users']) },
      relations: { workflow: true },
      order: { workflow: { name: 'ASC' }, version: 'ASC' },
    });
  });

  it('resolves a pinned revision by its workflow name whatever its status', async () => {
    const harness = createHarness();

    await harness.sut.findRevision(harness.manager, ['users'], 'base', 3);

    expect(harness.entityRepositoryMock.findOne).toHaveBeenCalledWith({
      where: { workflow: { name: 'base' }, version: 3, scope: In(['users']) },
      relations: { workflow: true },
    });
  });

  it('resolves an unpinned lookup to the highest published revision', async () => {
    const harness = createHarness();

    await harness.sut.findLatestPublished(harness.manager, ['users'], 'base');

    expect(harness.entityRepositoryMock.findOne).toHaveBeenCalledWith({
      where: { workflow: { name: 'base' }, scope: In(['users']), status: 'published' },
      relations: { workflow: true },
      order: { version: 'DESC' },
    });
  });

  it('counts every revision of a name regardless of status', async () => {
    const harness = createHarness();

    await harness.sut.countRevisions(harness.manager, ['users'], 'base');

    expect(harness.entityRepositoryMock.count).toHaveBeenCalledWith({
      where: { workflow: { name: 'base' }, scope: In(['users']) },
    });
  });

  it('counts only published revisions for the startup diagnostic', async () => {
    const harness = createHarness();

    await harness.sut.countPublished(harness.manager, ['built-in', 'users']);

    expect(harness.entityRepositoryMock.count).toHaveBeenCalledWith({
      where: { scope: In(['built-in', 'users']), status: 'published' },
    });
  });

  it('resolves a stored revision by its own uuid whatever its status', async () => {
    const harness = createHarness();

    await harness.sut.findVersionById(harness.manager, ['users'], 'a-version-uuid');

    expect(harness.entityRepositoryMock.findOne).toHaveBeenCalledWith({
      where: { workflowVersionId: 'a-version-uuid', scope: In(['users']) },
      relations: { workflow: true },
    });
  });
});
