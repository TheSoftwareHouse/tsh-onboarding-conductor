import { EntityManager, In, Repository } from 'typeorm';
import { generateUuidV7 } from '../utils/uuid.util';
import type { ListAdminWorkflowsQueryDto } from './dto/list-admin-workflows.query.dto';
import { WorkflowVersionEntity } from './entity/workflow-version.entity';
import { WorkflowScopeConflictError } from './errors/workflow-scope-conflict.error';
import { WorkflowVersionConflictError } from './errors/workflow-version-conflict.error';
import type { WorkflowFile } from './workflow-file-loader.service';
import type { WorkflowScope } from './workflow-scope';
import {
  DRAFT_WORKFLOW_STATUS,
  PUBLISHED_WORKFLOW_STATUS,
  type WorkflowStatus,
} from './workflow-status';
import { WorkflowsRepository } from './workflows.repository';

jest.mock('../utils/uuid.util');

const mockGenerateUuidV7 = generateUuidV7 as jest.Mock;

type WorkflowIdentityRow = { workflow_id: string; key: string; scope: WorkflowScope };
type StoredRevisionRow = {
  workflow_id: string;
  version: number;
  status: WorkflowStatus;
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
  status: PUBLISHED_WORKFLOW_STATUS,
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
      findOneOrFail: jest.fn().mockResolvedValue({ workflowVersionId: 'stored-version' }),
    } as unknown as Repository<WorkflowVersionEntity>;
    const query = jest.fn().mockImplementation((sql: string) => {
      if (
        sql.includes('SELECT workflow_id, key, scope FROM workflows') ||
        sql.includes('RETURNING workflow_id')
      ) {
        return Promise.resolve(identityRows);
      }

      if (sql.includes('FROM onboardings')) {
        return Promise.resolve([{ total: '3' }]);
      }

      if (sql.includes('FROM workflow_versions') && sql.startsWith('SELECT')) {
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

      expect(revisionRead[0]).toContain('SELECT workflow_id, version, status, definition');
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

    it('skips a file whose stored row is a draft, returning it instead of throwing', async () => {
      const file = createWorkflowFile('base', 1, 'users');
      const harness = createHarness(
        [identity('wf-base', 'base', 'users')],
        [
          createStoredRevision(file, 'wf-base', {
            status: DRAFT_WORKFLOW_STATUS,
            definition: { id: 'base', version: 1, steps: ['edited in the panel'] },
          }),
        ],
      );

      const result = await harness.sut.publishFromFiles(harness.manager, [file]);

      expect(result).toEqual({ skipped: [file] });
      expect(harness.findSql('INSERT INTO workflow_versions')).toBeUndefined();
      expect(harness.findSql('UPDATE workflows')).toBeUndefined();
    });

    it('returns an empty skipped list when no file collides with a draft', async () => {
      const harness = createHarness([identity('wf-base', 'base', 'fixtures')]);

      await expect(
        harness.sut.publishFromFiles(harness.manager, [createWorkflowFile('base', 1, 'fixtures')]),
      ).resolves.toEqual({ skipped: [] });
      await expect(harness.sut.publishFromFiles(harness.manager, [])).resolves.toEqual({
        skipped: [],
      });
    });

    it('still stores the other files while one collides with a draft', async () => {
      mockGenerateUuidV7
        .mockReturnValueOnce('candidate-base')
        .mockReturnValueOnce('version-base-2');
      const colliding = createWorkflowFile('base', 1, 'users');
      const harness = createHarness(
        [identity('wf-base', 'base', 'users')],
        [createStoredRevision(colliding, 'wf-base', { status: DRAFT_WORKFLOW_STATUS })],
      );

      const result = await harness.sut.publishFromFiles(harness.manager, [
        colliding,
        createWorkflowFile('base', 2, 'users'),
      ]);

      expect(result.skipped).toEqual([colliding]);
      const [, versionParameters] = harness.findSql('INSERT INTO workflow_versions')!;
      expect(versionParameters).toEqual([
        'version-base-2',
        'wf-base',
        2,
        'published',
        JSON.stringify({ id: 'base', version: 2 }),
      ]);
    });

    it('still refuses a file that differs from a published row while another collides with a draft', async () => {
      const draftFile = createWorkflowFile('draft-flow', 1, 'users');
      const published = createWorkflowFile('base', 1, 'users');
      const harness = createHarness(
        [identity('wf-draft', 'draft-flow', 'users'), identity('wf-base', 'base', 'users')],
        [
          createStoredRevision(draftFile, 'wf-draft', { status: DRAFT_WORKFLOW_STATUS }),
          createStoredRevision(published, 'wf-base', {
            definition: { id: 'base', version: 1, x: 1 },
          }),
        ],
      );

      await expect(
        harness.sut.publishFromFiles(harness.manager, [draftFile, published]),
      ).rejects.toBeInstanceOf(WorkflowVersionConflictError);
    });

    it('does not let a stored draft at a higher version block the label of a new file', async () => {
      const draft = createWorkflowFile('base', 5, 'users', 'Drafted');
      const harness = createHarness(
        [identity('wf-base', 'base', 'users')],
        [createStoredRevision(draft, 'wf-base', { status: DRAFT_WORKFLOW_STATUS })],
      );

      await harness.sut.publishFromFiles(harness.manager, [
        createWorkflowFile('base', 2, 'users', 'Base, revised'),
      ]);

      const [, labelParameters] = harness.findSql('UPDATE workflows')!;
      expect(labelParameters).toEqual(['wf-base', 'Base, revised']);
    });
  });

  describe('draft writes', () => {
    const document = { id: 'flow', version: 2, steps: [] };

    it('finds a family by key in any scope, and null when there is none', async () => {
      const found = createHarness([identity('wf-flow', 'flow', 'fixtures')]);
      const missing = createHarness();

      await expect(found.sut.findFamily(found.manager, 'flow')).resolves.toEqual({
        workflowId: 'wf-flow',
        key: 'flow',
        scope: 'fixtures',
      });
      await expect(missing.sut.findFamily(missing.manager, 'flow')).resolves.toBeNull();
      expect(found.findSql('WHERE key = $1')![1]).toEqual(['flow']);
    });

    it('creates a new family in users scope with its label, then inserts the draft', async () => {
      mockGenerateUuidV7.mockReturnValueOnce('new-family').mockReturnValueOnce('new-version');
      const harness = createHarness([identity('new-family', 'flow', 'users')]);

      const stored = await harness.sut.insertDraft(harness.manager, 'flow', 2, document, 'Flow');

      const [familySql, familyParameters] = harness.findSql('INSERT INTO workflows')!;
      expect(familySql).toContain(
        'ON CONFLICT ON CONSTRAINT uq_workflows_key DO UPDATE SET key = EXCLUDED.key',
      );
      expect(familySql).toContain('RETURNING workflow_id');
      expect(familyParameters).toEqual(['new-family', 'flow', 'users', 'Flow']);
      const [versionSql, versionParameters] = harness.findSql('INSERT INTO workflow_versions')!;
      expect(versionSql).toContain('$5::json');
      expect(versionParameters).toEqual([
        'new-version',
        'new-family',
        2,
        DRAFT_WORKFLOW_STATUS,
        JSON.stringify(document),
      ]);
      expect(harness.entityRepositoryMock.findOneOrFail).toHaveBeenCalledWith({
        where: { workflowVersionId: 'new-version' },
        relations: { workflow: true },
      });
      expect(stored).toEqual({ workflowVersionId: 'stored-version' });
    });

    it('writes the label only through the family insert, which leaves an existing family as it is', async () => {
      const harness = createHarness([identity('wf-flow', 'flow', 'users')]);

      await harness.sut.insertDraft(harness.manager, 'flow', 2, document, 'Renamed label');

      expect(harness.findSql('INSERT INTO workflows')![0]).toContain(
        'DO UPDATE SET key = EXCLUDED.key',
      );
      expect(harness.findSql('INSERT INTO workflows')![0]).not.toContain('name = EXCLUDED');
      expect(harness.findSql('UPDATE workflows')).toBeUndefined();
      expect(harness.findSql('INSERT INTO workflow_versions')![1][1]).toBe('wf-flow');
    });

    it('stores a null label when the draft declares none', async () => {
      const harness = createHarness([identity('wf-flow', 'flow', 'users')]);

      await harness.sut.insertDraft(harness.manager, 'flow', 2, document);

      expect(harness.findSql('INSERT INTO workflows')![1][3]).toBeNull();
    });

    it('lets a unique violation from the insert reach the caller unmapped', async () => {
      const harness = createHarness([identity('wf-flow', 'flow', 'users')]);
      const violation = Object.assign(new Error('duplicate'), { code: '23505' });
      (harness.manager.query as jest.Mock).mockImplementation((sql: string) =>
        sql.includes('INSERT INTO workflow_versions')
          ? Promise.reject(violation)
          : Promise.resolve([identity('wf-flow', 'flow', 'users')]),
      );

      await expect(harness.sut.insertDraft(harness.manager, 'flow', 2, document)).rejects.toBe(
        violation,
      );
    });

    it('updates only a draft row, moving it to the target family and refreshing updated_at', async () => {
      const harness = createHarness([identity('wf-target', 'target', 'users')]);

      await harness.sut.updateDraft(harness.manager, 'v-1', 'target', 3, document, 'Target');

      const [updateSql, updateParameters] = harness.findSql('UPDATE workflow_versions')!;
      expect(updateSql).toContain('updated_at = now()');
      expect(updateSql).toContain('status = $5');
      expect(updateParameters).toEqual([
        'v-1',
        'wf-target',
        3,
        JSON.stringify(document),
        DRAFT_WORKFLOW_STATUS,
      ]);
      expect(harness.findSql('INSERT INTO workflows')![1][3]).toBe('Target');
    });

    it('deletes only a draft row', async () => {
      const harness = createHarness();

      await harness.sut.deleteDraft(harness.manager, 'v-1');

      const [sql, parameters] = harness.findSql('DELETE FROM workflow_versions')!;
      expect(sql).toContain('status = $2');
      expect(parameters).toEqual(['v-1', DRAFT_WORKFLOW_STATUS]);
    });

    it('deletes a family only while it has no versions', async () => {
      const harness = createHarness();

      await harness.sut.deleteEmptyFamily(harness.manager, 'wf-old');

      const [sql, parameters] = harness.findSql('DELETE FROM workflows')!;
      expect(sql).toContain('NOT EXISTS (SELECT 1 FROM workflow_versions WHERE workflow_id = $1)');
      expect(parameters).toEqual(['wf-old']);
    });

    it('locks the family row in a statement of its own before the delete', async () => {
      const harness = createHarness();

      await harness.sut.deleteEmptyFamily(harness.manager, 'wf-old');

      const sqls = harness.sqlCalls().map(([sql]) => sql);
      const lockAt = sqls.findIndex((sql) =>
        sql.includes('FROM workflows WHERE workflow_id = $1 FOR UPDATE'),
      );
      const deleteAt = sqls.findIndex((sql) => sql.includes('DELETE FROM workflows'));
      expect(lockAt).toBeGreaterThanOrEqual(0);
      expect(lockAt).toBeLessThan(deleteAt);
      expect(harness.sqlCalls()[lockAt][1]).toEqual(['wf-old']);
    });

    it('row-locks only the revision when asked to lock it', async () => {
      const harness = createHarness();

      await harness.sut.lockRevision(harness.manager, ['users'], 'base', 2);

      const [sql, parameters] = harness.findSql('FOR UPDATE OF v')!;
      expect(sql).toContain('FROM workflow_versions v');
      expect(parameters).toEqual(['base', ['users'], 2]);
    });

    it('counts the onboardings pinned to a revision as a number', async () => {
      const harness = createHarness();

      await expect(harness.sut.countOnboardings(harness.manager, 'v-1')).resolves.toBe(3);
      expect(harness.findSql('FROM onboardings')![1]).toEqual(['v-1']);
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

  it('reads every revision of one family, definitions included, oldest first', async () => {
    const harness = createHarness();

    await harness.sut.findRevisions(harness.manager, ['users'], 'base');

    expect(harness.entityRepositoryMock.find).toHaveBeenCalledWith({
      where: { workflow: { key: 'base', scope: In(['users']) } },
      relations: { workflow: true },
      order: { version: 'ASC' },
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

  describe('listVersions', () => {
    it('selects only the version columns, newest first, within the scopes', async () => {
      const { sut, manager, entityRepositoryMock } = createHarness();

      await sut.listVersions(manager, ['users'], 'base');

      expect(entityRepositoryMock.find).toHaveBeenCalledWith({
        select: { version: true, status: true, createdAt: true, updatedAt: true },
        where: { workflow: { key: 'base', scope: In(['users']) } },
        order: { version: 'DESC' },
      });
    });
  });

  describe('listForAdmin', () => {
    const createListHarness = (rawRows: unknown[], total = rawRows.length) => {
      const query = jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('SELECT count(*) AS total')) {
          return Promise.resolve([{ total: String(total) }]);
        }

        return Promise.resolve(rawRows);
      });
      const manager = { query } as unknown as EntityManager;

      return { sut: new WorkflowsRepository(), manager, query };
    };

    it('runs the total count and the page query against the same filters', async () => {
      const harness = createListHarness([]);

      await harness.sut.listForAdmin(harness.manager, ['built-in', 'users'], {
        page: 1,
        limit: 20,
      } as ListAdminWorkflowsQueryDto);

      const [totalSql, totalParameters] = harness.query.mock.calls[0];
      expect(totalSql).toContain(
        'SELECT count(*) AS total FROM workflows w WHERE w.scope = ANY($1::varchar[])',
      );
      expect(totalParameters).toEqual([['built-in', 'users']]);

      const [pageSql, pageParameters] = harness.query.mock.calls[1];
      expect(pageSql).toContain('GROUP BY w.workflow_id');
      expect(pageSql).toContain('ORDER BY w.key ASC');
      expect(pageSql).toContain('MAX(CASE WHEN wv.status = $2 THEN wv.version END)');
      expect(pageSql).toContain('FILTER (WHERE wv.status = $3)');
      expect(pageSql).toContain('LIMIT $4 OFFSET $5');
      expect(pageSql).toMatch(
        /ON o\.workflow_version_id = wv\.workflow_version_id AND o\.completed_at IS NULL/,
      );
      expect(pageSql).not.toContain('definition');
      expect(pageParameters).toEqual([
        ['built-in', 'users'],
        PUBLISHED_WORKFLOW_STATUS,
        DRAFT_WORKFLOW_STATUS,
        20,
        0,
      ]);
    });

    it('escapes LIKE wildcards in the search text before wrapping it', async () => {
      const harness = createListHarness([]);

      await harness.sut.listForAdmin(harness.manager, ['users'], {
        page: 1,
        limit: 20,
        search: 'a%b',
      } as ListAdminWorkflowsQueryDto);

      const [totalSql, totalParameters] = harness.query.mock.calls[0];
      expect(totalSql).toContain("(w.key ILIKE $2 ESCAPE '\\' OR w.name ILIKE $2 ESCAPE '\\')");
      expect(totalParameters).toEqual([['users'], '%a\\%b%']);
    });

    it('applies the scope filter and narrows on hasDraft only when it is true', async () => {
      const harness = createListHarness([]);

      await harness.sut.listForAdmin(harness.manager, ['users'], {
        page: 1,
        limit: 20,
        scope: 'users',
        hasDraft: true,
      } as ListAdminWorkflowsQueryDto);

      const [totalSql, totalParameters] = harness.query.mock.calls[0];
      expect(totalSql).toContain('w.scope = $2');
      expect(totalSql).toContain(
        'EXISTS (SELECT 1 FROM workflow_versions dv WHERE dv.workflow_id = w.workflow_id AND dv.status = $3)',
      );
      expect(totalParameters).toEqual([['users'], 'users', DRAFT_WORKFLOW_STATUS]);
    });

    it('ignores hasDraft when it is false', async () => {
      const harness = createListHarness([]);

      await harness.sut.listForAdmin(harness.manager, ['users'], {
        page: 1,
        limit: 20,
        hasDraft: false,
      } as ListAdminWorkflowsQueryDto);

      const [totalSql] = harness.query.mock.calls[0];
      expect(totalSql).not.toContain('EXISTS');
    });

    it('maps the raw rows into camelCase, coercing the bigint counts to numbers', async () => {
      const rawRow = {
        workflow_id: 'base',
        name: 'Base',
        scope: 'fixtures',
        serving_version: 2,
        version_count: '3',
        draft_count: '1',
        in_progress_count: '5',
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        updated_at: new Date('2024-01-02T00:00:00.000Z'),
      };
      const harness = createListHarness([rawRow], 7);

      const result = await harness.sut.listForAdmin(harness.manager, ['fixtures'], {
        page: 2,
        limit: 1,
      } as ListAdminWorkflowsQueryDto);

      expect(result).toEqual({
        items: [
          {
            workflowId: 'base',
            name: 'Base',
            scope: 'fixtures',
            servingVersion: 2,
            versionCount: 3,
            draftCount: 1,
            inProgressCount: 5,
            createdAt: rawRow.created_at,
            updatedAt: rawRow.updated_at,
          },
        ],
        total: 7,
        page: 2,
        limit: 1,
        totalPages: 7,
      });
    });
  });
});
