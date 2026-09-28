import { EntityManager, In, Repository } from 'typeorm';
import { generateUuidV7 } from '../utils/uuid.util';
import { WorkflowVersionEntity } from './entity/workflow-version.entity';
import { WorkflowScopeConflictError } from './errors/workflow-scope-conflict.error';
import { WorkflowVersionConflictError } from './errors/workflow-version-conflict.error';
import type { WorkflowFile } from './workflow-file-loader.service';
import type { WorkflowScope } from './workflow-scope';
import { WorkflowsRepository } from './workflows.repository';

jest.mock('../utils/uuid.util');

const mockGenerateUuidV7 = generateUuidV7 as jest.Mock;

type WorkflowIdentityRow = { workflow_id: string; key: string; scope: WorkflowScope };
type StoredRevisionRow = {
  workflow_id: string;
  version: number;
  definition: Record<string, unknown> | string;
};
type SqlCall = [sql: string, parameters: unknown[]];

const createWorkflowFile = (
  workflowId: string,
  version: number,
  scope: WorkflowScope,
  name?: string,
): WorkflowFile => ({
  scope,
  filePath: `/workflows/${scope}/${workflowId}.workflow.json`,
  workflowId,
  version,
  ...(name === undefined ? {} : { name }),
  definition: { id: workflowId, version, ...(name === undefined ? {} : { name }) },
});

const identity = (workflowId: string, key: string, scope: WorkflowScope): WorkflowIdentityRow => ({
  workflow_id: workflowId,
  key,
  scope,
});

/** The row the publish would have written for `file`, as the pre-publish read hands it back. */
const createStoredRevision = (
  file: WorkflowFile,
  workflowId: string,
  overrides: Partial<StoredRevisionRow> = {},
): StoredRevisionRow => ({
  workflow_id: workflowId,
  version: file.version,
  definition: file.definition,
  ...overrides,
});

describe('WorkflowsRepository', () => {
  const createHarness = (
    identityRows: WorkflowIdentityRow[] = [],
    storedRevisions: StoredRevisionRow[] = [],
  ) => {
    const entityRepositoryMock = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    } as unknown as Repository<WorkflowVersionEntity>;
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('SELECT workflow_id, key, scope FROM workflows')) {
        return Promise.resolve(identityRows);
      }

      if (sql.includes('FROM workflow_versions')) {
        return Promise.resolve(storedRevisions);
      }

      return Promise.resolve(undefined);
    });
    const manager = {
      query,
      getRepository: jest.fn().mockReturnValue(entityRepositoryMock),
      transaction: jest.fn((run: (manager: EntityManager) => Promise<void>) => run(manager)),
    } as unknown as EntityManager;
    const sqlCalls = (): SqlCall[] => query.mock.calls as SqlCall[];
    const findSql = (fragment: string): SqlCall | undefined =>
      sqlCalls().find(([sql]) => sql.includes(fragment));

    return { sut: new WorkflowsRepository(), manager, entityRepositoryMock, sqlCalls, findSql };
  };

  describe('publishFromFiles', () => {
    it('skips the database entirely when no file was discovered', async () => {
      const harness = createHarness();

      await harness.sut.publishFromFiles(harness.manager, []);

      expect(harness.manager.transaction).not.toHaveBeenCalled();
      expect(harness.manager.query).not.toHaveBeenCalled();
    });

    it('runs the whole publish inside one transaction', async () => {
      const harness = createHarness([identity('wf-base', 'base', 'fixtures')]);

      await harness.sut.publishFromFiles(harness.manager, [
        createWorkflowFile('base', 1, 'fixtures'),
      ]);

      expect(harness.manager.transaction).toHaveBeenCalledTimes(1);
    });

    it('numbers the placeholders of every row and passes the definition as JSON', async () => {
      mockGenerateUuidV7
        .mockReturnValueOnce('candidate-base')
        .mockReturnValueOnce('candidate-custom')
        .mockReturnValueOnce('version-base-1')
        .mockReturnValueOnce('version-custom-4');
      const harness = createHarness([
        identity('wf-base', 'base', 'fixtures'),
        identity('wf-custom', 'custom', 'users'),
      ]);

      await harness.sut.publishFromFiles(harness.manager, [
        createWorkflowFile('base', 1, 'fixtures'),
        createWorkflowFile('custom', 4, 'users'),
      ]);

      const [identities, identityRead, revisionRead, versions] = harness.sqlCalls();
      expect(harness.sqlCalls()).toHaveLength(4);

      expect(identities[0]).toContain('INSERT INTO workflows (workflow_id, key, scope)');
      expect(identities[0]).toContain('($1, $2, $3), ($4, $5, $6)');
      expect(identities[0]).toContain('ON CONFLICT ON CONSTRAINT uq_workflows_key DO NOTHING');
      expect(identities[1]).toEqual([
        'candidate-base',
        'base',
        'fixtures',
        'candidate-custom',
        'custom',
        'users',
      ]);

      expect(identityRead[0]).toContain('SELECT workflow_id, key, scope FROM workflows');
      expect(identityRead[1]).toEqual([['base', 'custom']]);

      expect(revisionRead[0]).toContain('SELECT workflow_id, version, definition');
      expect(revisionRead[0]).not.toContain('scope');
      expect(revisionRead[1]).toEqual([['wf-base', 'wf-custom']]);

      expect(versions[0]).toContain(
        'INSERT INTO workflow_versions (workflow_version_id, workflow_id, version, status, definition)',
      );
      expect(versions[0]).toContain('($1, $2, $3, $4, $5::json), ($6, $7, $8, $9, $10::json)');
      expect(versions[1]).toEqual([
        'version-base-1',
        'wf-base',
        1,
        'published',
        JSON.stringify({ id: 'base', version: 1 }),
        'version-custom-4',
        'wf-custom',
        4,
        'published',
        JSON.stringify({ id: 'custom', version: 4 }),
      ]);
    });

    it('reuses the existing parent row across two revisions of the same key rather than inserting another one', async () => {
      mockGenerateUuidV7
        .mockReturnValueOnce('candidate-base')
        .mockReturnValueOnce('version-base-1')
        .mockReturnValueOnce('version-base-2');
      // The identity read reports the row's real, already-stored id, distinct from the freshly
      // generated candidate the insert attempted — exactly what `ON CONFLICT ... DO NOTHING` leaves
      // behind when the key already had a parent.
      const harness = createHarness([identity('existing-wf-base', 'base', 'fixtures')]);

      await harness.sut.publishFromFiles(harness.manager, [
        createWorkflowFile('base', 1, 'fixtures'),
        createWorkflowFile('base', 2, 'fixtures'),
      ]);

      const [identities] = harness.sqlCalls();
      expect(identities[0]).toContain('($1, $2, $3)');
      expect(identities[0]).not.toContain('$4');
      expect(identities[1]).toEqual(['candidate-base', 'base', 'fixtures']);

      expect(harness.findSql('INSERT INTO workflow_versions')![1]).toEqual([
        'version-base-1',
        'existing-wf-base',
        1,
        'published',
        JSON.stringify({ id: 'base', version: 1 }),
        'version-base-2',
        'existing-wf-base',
        2,
        'published',
        JSON.stringify({ id: 'base', version: 2 }),
      ]);
    });

    it('never rewrites a revision that is already stored, its status included', async () => {
      const harness = createHarness([identity('wf-base', 'base', 'fixtures')]);

      await harness.sut.publishFromFiles(harness.manager, [
        createWorkflowFile('base', 1, 'fixtures'),
      ]);

      const [versionSql] = harness.findSql('INSERT INTO workflow_versions')!;
      expect(versionSql).toContain(
        'ON CONFLICT ON CONSTRAINT uq_workflow_versions_workflow_version DO NOTHING',
      );
      expect(versionSql).not.toContain('DO UPDATE');
    });

    it('refuses a file whose family is stored under another scope, before touching workflow_versions', async () => {
      const file = createWorkflowFile('base', 2, 'users');
      const harness = createHarness([identity('wf-base', 'base', 'fixtures')]);

      await expect(harness.sut.publishFromFiles(harness.manager, [file])).rejects.toThrow(
        WorkflowScopeConflictError,
      );
      await expect(harness.sut.publishFromFiles(harness.manager, [file])).rejects.toMatchObject({
        workflowId: 'base',
        scope: 'users',
        filePath: file.filePath,
        ownerScope: 'fixtures',
        ownerFilePath: undefined,
        message: expect.stringContaining(
          `Workflow "base" is stored under the "fixtures" scope, but ${file.filePath} declares it under the "users" scope`,
        ),
      });
      await expect(harness.sut.publishFromFiles(harness.manager, [file])).rejects.toThrow(
        'workflows/users/eu-b2c-individual-kyc-eea-local.workflow.json',
      );
      expect(harness.findSql('FROM workflow_versions')).toBeUndefined();
      expect(harness.findSql('INSERT INTO workflow_versions')).toBeUndefined();
    });

    it('refuses the scope mismatch even when the revision itself is already stored', async () => {
      const file = createWorkflowFile('base', 1, 'users');
      const harness = createHarness(
        [identity('wf-base', 'base', 'fixtures')],
        [createStoredRevision(file, 'wf-base')],
      );

      await expect(harness.sut.publishFromFiles(harness.manager, [file])).rejects.toThrow(
        WorkflowScopeConflictError,
      );
    });

    it('leaves a stored revision alone when the file still matches it', async () => {
      const file = createWorkflowFile('base', 1, 'fixtures', 'Base');
      const harness = createHarness(
        [identity('wf-base', 'base', 'fixtures')],
        [createStoredRevision(file, 'wf-base')],
      );

      await harness.sut.publishFromFiles(harness.manager, [file]);

      expect(harness.findSql('INSERT INTO workflow_versions')).toBeUndefined();
      expect(harness.findSql('UPDATE workflows')).toBeUndefined();
    });

    it('compares definitions by content, so a stored row read back as text still matches', async () => {
      const file = createWorkflowFile('base', 1, 'fixtures');
      const harness = createHarness(
        [identity('wf-base', 'base', 'fixtures')],
        [createStoredRevision(file, 'wf-base', { definition: '{ "id": "base",\n "version": 1 }' })],
      );

      await harness.sut.publishFromFiles(harness.manager, [file]);

      expect(harness.findSql('INSERT INTO workflow_versions')).toBeUndefined();
    });

    it('refuses a file whose definition differs from the revision stored under its id and version', async () => {
      const file = createWorkflowFile('base', 1, 'fixtures');
      const harness = createHarness(
        [identity('wf-base', 'base', 'fixtures')],
        [
          createStoredRevision(file, 'wf-base', {
            definition: { id: 'base', version: 1, initial: 'elsewhere' },
          }),
        ],
      );

      await expect(harness.sut.publishFromFiles(harness.manager, [file])).rejects.toThrow(
        WorkflowVersionConflictError,
      );
      await expect(harness.sut.publishFromFiles(harness.manager, [file])).rejects.toMatchObject({
        workflowId: 'base',
        version: 1,
        filePath: file.filePath,
        message: expect.stringContaining(
          '"base" version 1 is already stored with a different definition',
        ),
      });
      expect(harness.findSql('INSERT INTO workflow_versions')).toBeUndefined();
    });

    it('stores only the revisions not stored yet', async () => {
      mockGenerateUuidV7
        .mockReturnValueOnce('candidate-base')
        .mockReturnValueOnce('version-base-2');
      const stored = createWorkflowFile('base', 1, 'fixtures');
      const harness = createHarness(
        [identity('wf-base', 'base', 'fixtures')],
        [createStoredRevision(stored, 'wf-base')],
      );

      await harness.sut.publishFromFiles(harness.manager, [
        stored,
        createWorkflowFile('base', 2, 'fixtures'),
      ]);

      const [versionSql, versionParameters] = harness.findSql('INSERT INTO workflow_versions')!;
      expect(versionSql).not.toContain('$6');
      expect(versionParameters).toEqual([
        'version-base-2',
        'wf-base',
        2,
        'published',
        JSON.stringify({ id: 'base', version: 2 }),
      ]);
    });

    it('labels the family with the name of the highest version it stores that declares one', async () => {
      const harness = createHarness([
        identity('wf-base', 'base', 'fixtures'),
        identity('wf-custom', 'custom', 'users'),
      ]);

      await harness.sut.publishFromFiles(harness.manager, [
        createWorkflowFile('base', 2, 'fixtures', 'Base, revised'),
        createWorkflowFile('base', 1, 'fixtures', 'Base'),
        createWorkflowFile('base', 3, 'fixtures'),
        createWorkflowFile('custom', 1, 'users', 'Custom'),
      ]);

      const [labelSql, labelParameters] = harness.findSql('UPDATE workflows')!;
      expect(labelSql).toContain('SET name = labels.name, updated_at = now()');
      expect(labelSql).toContain('workflows.name IS DISTINCT FROM labels.name');
      expect(labelSql).toContain('($1::uuid, $2::varchar), ($3::uuid, $4::varchar)');
      expect(labelParameters).toEqual(['wf-base', 'Base, revised', 'wf-custom', 'Custom']);
    });

    it('leaves the label alone when no stored file declares a name', async () => {
      const harness = createHarness([identity('wf-base', 'base', 'fixtures')]);

      await harness.sut.publishFromFiles(harness.manager, [
        createWorkflowFile('base', 1, 'fixtures'),
      ]);

      expect(harness.findSql('UPDATE workflows')).toBeUndefined();
    });

    it('does not let a lower version stored later take the label from a higher one already stored', async () => {
      const stored = createWorkflowFile('base', 2, 'fixtures', 'Base, revised');
      const harness = createHarness(
        [identity('wf-base', 'base', 'fixtures')],
        [createStoredRevision(stored, 'wf-base')],
      );

      await harness.sut.publishFromFiles(harness.manager, [
        createWorkflowFile('base', 1, 'fixtures', 'Base'),
        stored,
      ]);

      expect(harness.findSql('INSERT INTO workflow_versions')).toBeDefined();
      expect(harness.findSql('UPDATE workflows')).toBeUndefined();
    });
  });

  it('reads back only the requested scopes, through the family', async () => {
    const harness = createHarness();

    await harness.sut.findAll(harness.manager, ['built-in', 'users']);

    expect(harness.manager.getRepository).toHaveBeenCalledWith(WorkflowVersionEntity);
    expect(harness.entityRepositoryMock.find).toHaveBeenCalledWith({
      where: { workflow: { scope: In(['built-in', 'users']) } },
      relations: { workflow: true },
      order: { workflow: { key: 'ASC' }, version: 'ASC' },
    });
  });

  it('resolves a pinned revision by its workflow key whatever its status', async () => {
    const harness = createHarness();

    await harness.sut.findRevision(harness.manager, ['users'], 'base', 3);

    expect(harness.entityRepositoryMock.findOne).toHaveBeenCalledWith({
      where: { workflow: { key: 'base', scope: In(['users']) }, version: 3 },
      relations: { workflow: true },
    });
  });

  it('resolves an unpinned lookup to the highest published revision', async () => {
    const harness = createHarness();

    await harness.sut.findLatestPublished(harness.manager, ['users'], 'base');

    expect(harness.entityRepositoryMock.findOne).toHaveBeenCalledWith({
      where: { workflow: { key: 'base', scope: In(['users']) }, status: 'published' },
      relations: { workflow: true },
      order: { version: 'DESC' },
    });
  });

  it('counts every revision of a key regardless of status', async () => {
    const harness = createHarness();

    await harness.sut.countRevisions(harness.manager, ['users'], 'base');

    expect(harness.entityRepositoryMock.count).toHaveBeenCalledWith({
      where: { workflow: { key: 'base', scope: In(['users']) } },
    });
  });

  it('counts only published revisions for the startup diagnostic', async () => {
    const harness = createHarness();

    await harness.sut.countPublished(harness.manager, ['built-in', 'users']);

    expect(harness.entityRepositoryMock.count).toHaveBeenCalledWith({
      where: { workflow: { scope: In(['built-in', 'users']) }, status: 'published' },
    });
  });

  it('resolves a stored revision by its own uuid whatever its status', async () => {
    const harness = createHarness();

    await harness.sut.findVersionById(harness.manager, ['users'], 'a-version-uuid');

    expect(harness.entityRepositoryMock.findOne).toHaveBeenCalledWith({
      where: { workflowVersionId: 'a-version-uuid', workflow: { scope: In(['users']) } },
      relations: { workflow: true },
    });
  });
});
