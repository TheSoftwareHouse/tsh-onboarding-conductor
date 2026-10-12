import type { DataSource, EntityManager } from 'typeorm';
import type { AuditService } from '../audit/audit.service';
import { WorkflowDraftExistsException } from './errors/workflow-draft-exists.exception';
import { WorkflowDraftInUseException } from './errors/workflow-draft-in-use.exception';
import { WorkflowInvalidException } from './errors/workflow-invalid.exception';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowScopeConflictException } from './errors/workflow-scope-conflict.exception';
import { WorkflowVersionExistsException } from './errors/workflow-version-exists.exception';
import { WorkflowConnectorDeclarationInvalidException } from './errors/workflow-connector-declaration-invalid.exception';
import { WorkflowSourceKeyConflictException } from './errors/workflow-source-key-conflict.exception';
import { WorkflowVersionNotDraftException } from './errors/workflow-version-not-draft.exception';
import { WorkflowVersionNotLatestException } from './errors/workflow-version-not-latest.exception';
import type { WorkflowCompilationService } from './workflow-compilation.service';
import type { WorkflowFileLoaderService } from './workflow-file-loader.service';
import type { WorkflowVersionEntity } from './entity/workflow-version.entity';
import { WorkflowDraftsService } from './workflow-drafts.service';
import type { WorkflowRegistryService } from './workflow-registry.service';
import type { WorkflowScope } from './workflow-scope';
import type { WorkflowStatus } from './workflow-status';
import type { WorkflowsRepository } from './workflows.repository';

const OPERATOR = 'operator-1';
const ACTIVE_SCOPES: readonly WorkflowScope[] = ['built-in', 'users'];
const WORKFLOW_VERSION_CONSTRAINT = 'uq_workflow_versions_workflow_version';
const ONE_DRAFT_CONSTRAINT = 'uq_workflow_versions_one_draft';

const manager = { id: 'transaction-manager' } as unknown as EntityManager;
const rootManager = { id: 'root-manager' } as unknown as EntityManager;

const createRow = (
  overrides: {
    key?: string;
    version?: number;
    status?: WorkflowStatus;
    name?: string | null;
    workflowId?: string;
    workflowVersionId?: string;
    definition?: Record<string, unknown>;
  } = {},
): WorkflowVersionEntity =>
  ({
    workflowVersionId: overrides.workflowVersionId ?? 'version-uuid',
    workflowId: overrides.workflowId ?? 'family-uuid',
    version: overrides.version ?? 1,
    status: overrides.status ?? 'draft',
    definition: overrides.definition ?? { id: 'flow', version: 1, steps: [] },
    createdAt: new Date('2026-10-06T10:00:00Z'),
    updatedAt: new Date('2026-10-06T11:00:00Z'),
    workflow: {
      workflowId: overrides.workflowId ?? 'family-uuid',
      key: overrides.key ?? 'flow',
      name: overrides.name === undefined ? null : overrides.name,
    },
  }) as unknown as WorkflowVersionEntity;

const uniqueViolation = (constraint: string) => ({ driverError: { code: '23505', constraint } });

const createService = () => {
  const dataSource = {
    manager: rootManager,
    transaction: jest.fn(async (work: (tx: EntityManager) => Promise<unknown>) => work(manager)),
  } as unknown as jest.Mocked<DataSource>;
  const repository = {
    findRevision: jest.fn().mockResolvedValue(null),
    findFamily: jest.fn().mockResolvedValue(null),
    listVersions: jest.fn().mockResolvedValue([]),
    countOnboardings: jest.fn().mockResolvedValue(0),
    insertDraft: jest.fn(),
    updateDraft: jest.fn(),
    lockRevision: jest.fn().mockResolvedValue(undefined),
    deleteDraft: jest.fn().mockResolvedValue(undefined),
    deleteEmptyFamily: jest.fn().mockResolvedValue(undefined),
    lockPublishing: jest.fn().mockResolvedValue(undefined),
    findLatestPublished: jest.fn().mockResolvedValue(null),
    publishDraft: jest.fn(),
    relabelFamily: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<WorkflowsRepository>;
  const registry = {
    getActiveScopes: jest.fn().mockReturnValue(ACTIVE_SCOPES),
  } as unknown as jest.Mocked<WorkflowRegistryService>;
  const compilation = {
    compile: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<WorkflowCompilationService>;
  const fileLoader = {
    load: jest.fn().mockReturnValue([]),
  } as unknown as jest.Mocked<WorkflowFileLoaderService>;
  const audit = {
    logWorkflowDraft: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditService>;

  return {
    dataSource,
    repository,
    compilation,
    fileLoader,
    audit,
    service: new WorkflowDraftsService(
      dataSource,
      repository,
      registry,
      compilation,
      fileLoader,
      audit,
    ),
  };
};

describe('WorkflowDraftsService', () => {
  describe('create', () => {
    const document = { id: 'flow', version: 2, name: 'My flow', steps: [] };

    it('stores the document and answers the draft without it', async () => {
      const { service, repository, audit } = createService();

      repository.insertDraft.mockResolvedValue(
        createRow({ version: 2, name: 'My flow', workflowVersionId: 'new-uuid' }),
      );

      await expect(service.create(document, OPERATOR)).resolves.toEqual({
        workflowId: 'flow',
        version: 2,
        status: 'draft',
        name: 'My flow',
        createdAt: new Date('2026-10-06T10:00:00Z'),
        updatedAt: new Date('2026-10-06T11:00:00Z'),
      });
      expect(repository.insertDraft).toHaveBeenCalledWith(manager, 'flow', 2, document, 'My flow');
      expect(audit.logWorkflowDraft).toHaveBeenCalledTimes(1);
      expect(audit.logWorkflowDraft).toHaveBeenCalledWith(manager, {
        action: 'workflow_draft.created',
        actorId: OPERATOR,
        resourceId: 'new-uuid',
        metadata: { workflowId: 'flow', version: 2 },
      });
    });

    it('passes a label only when it is a string of 1 to 200 characters', async () => {
      const { service, repository } = createService();

      repository.insertDraft.mockResolvedValue(createRow());

      await service.create({ id: 'flow', version: 1, name: '' }, OPERATOR);
      await service.create({ id: 'flow', version: 1, name: 'x'.repeat(201) }, OPERATOR);
      await service.create({ id: 'flow', version: 1, name: 7 }, OPERATOR);

      for (const call of repository.insertDraft.mock.calls) {
        expect(call[4]).toBeUndefined();
      }
    });

    it.each([
      ['not an object', 'text', undefined],
      ['an array', [], undefined],
      ['an id that is not a string', { id: 1, version: 1 }, 'id'],
      ['an empty id', { id: '', version: 1 }, 'id'],
      ['an id wider than a key', { id: 'x'.repeat(101), version: 1 }, 'id'],
      ['a version of zero', { id: 'flow', version: 0 }, 'version'],
      ['a fractional version', { id: 'flow', version: 1.5 }, 'version'],
      ['a version that is a string', { id: 'flow', version: '1' }, 'version'],
      ['a version past the integer column', { id: 'flow', version: 2_147_483_648 }, 'version'],
    ])('refuses %s as WORKFLOW_INVALID', async (_label, body, path) => {
      const { service, dataSource } = createService();

      const failure = await service.create(body, OPERATOR).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(WorkflowInvalidException);
      expect((failure as WorkflowInvalidException).getResponse()).toMatchObject({
        code: 'WORKFLOW_INVALID',
        reason: 'INVALID_SHAPE',
        ...(path === undefined ? {} : { path }),
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses a family that lives in another scope', async () => {
      const { service, repository, audit } = createService();

      repository.findFamily.mockResolvedValue({
        workflowId: 'uuid',
        key: 'flow',
        scope: 'fixtures',
      });

      await expect(service.create(document, OPERATOR)).rejects.toThrow(
        WorkflowScopeConflictException,
      );
      expect(repository.insertDraft).not.toHaveBeenCalled();
      expect(audit.logWorkflowDraft).not.toHaveBeenCalled();
    });

    it('refuses a version that exists in any status', async () => {
      const { service, repository } = createService();

      repository.listVersions.mockResolvedValue([createRow({ version: 2, status: 'retired' })]);

      await expect(service.create(document, OPERATOR)).rejects.toThrow(
        WorkflowVersionExistsException,
      );
    });

    it('refuses a second draft in the family and names the first', async () => {
      const { service, repository } = createService();

      repository.listVersions.mockResolvedValue([createRow({ version: 5, status: 'draft' })]);

      const failure = await service.create(document, OPERATOR).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(WorkflowDraftExistsException);
      expect((failure as WorkflowDraftExistsException).getResponse()).toMatchObject({
        workflowId: 'flow',
        draftVersion: 5,
      });
    });

    it('maps a lost race on the version constraint to WORKFLOW_VERSION_EXISTS', async () => {
      const { service, repository } = createService();

      repository.insertDraft.mockRejectedValue(uniqueViolation(WORKFLOW_VERSION_CONSTRAINT));

      await expect(service.create(document, OPERATOR)).rejects.toThrow(
        WorkflowVersionExistsException,
      );
    });

    it('maps a lost race on the one-draft index to WORKFLOW_DRAFT_EXISTS after the rollback', async () => {
      const { service, repository } = createService();

      repository.insertDraft.mockRejectedValue(uniqueViolation(ONE_DRAFT_CONSTRAINT));
      repository.listVersions
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([createRow({ version: 9 })]);

      const failure = await service.create(document, OPERATOR).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(WorkflowDraftExistsException);
      expect((failure as WorkflowDraftExistsException).getResponse()).toMatchObject({
        draftVersion: 9,
      });
      expect(repository.listVersions).toHaveBeenLastCalledWith(rootManager, ACTIVE_SCOPES, 'flow');
    });

    it('lets any other failure through', async () => {
      const { service, repository } = createService();
      const failure = new Error('connection lost');

      repository.insertDraft.mockRejectedValue(failure);

      await expect(service.create(document, OPERATOR)).rejects.toBe(failure);
    });
  });

  describe('getDocument', () => {
    it('serves the stored document of a draft', async () => {
      const { service, repository } = createService();
      const definition = { id: 'flow', version: 1, anything: 'goes' };

      repository.findRevision.mockResolvedValue(createRow({ definition }));

      await expect(service.getDocument('flow', 1)).resolves.toMatchObject({
        workflowId: 'flow',
        status: 'draft',
        document: definition,
      });
      expect(repository.findRevision).toHaveBeenCalledWith(rootManager, ACTIVE_SCOPES, 'flow', 1);
    });

    it('answers 404 for a revision that is not stored', async () => {
      const { service } = createService();

      await expect(service.getDocument('flow', 1)).rejects.toThrow(WorkflowNotFoundException);
    });

    it.each(['published', 'retired'] as const)(
      'serves the stored document of a %s revision without locking',
      async (status) => {
        const { service, repository } = createService();
        const definition = { id: 'flow', version: 1, anything: 'goes' };

        repository.findRevision.mockResolvedValue(createRow({ status, definition }));

        await expect(service.getDocument('flow', 1)).resolves.toMatchObject({
          workflowId: 'flow',
          status,
          document: definition,
        });
        expect(repository.lockRevision).not.toHaveBeenCalled();
      },
    );
  });

  describe('update', () => {
    const document = { id: 'flow', version: 1, steps: [{ name: 'a' }] };

    it('replaces the content in place and audits an update without a previous id', async () => {
      const { service, repository, audit } = createService();

      repository.findRevision.mockResolvedValue(createRow());
      repository.listVersions.mockResolvedValue([createRow()]);
      repository.updateDraft.mockResolvedValue(createRow());

      await service.update('flow', 1, document, OPERATOR);

      expect(repository.updateDraft).toHaveBeenCalledWith(
        manager,
        'version-uuid',
        'flow',
        1,
        document,
        undefined,
      );
      expect(repository.deleteEmptyFamily).not.toHaveBeenCalled();
      expect(audit.logWorkflowDraft).toHaveBeenCalledTimes(1);
      expect(audit.logWorkflowDraft).toHaveBeenCalledWith(manager, {
        action: 'workflow_draft.updated',
        actorId: OPERATOR,
        resourceId: 'version-uuid',
        metadata: { workflowId: 'flow', version: 1 },
      });
    });

    it('moves a draft to a new family, deletes the emptied old one and records where it came from', async () => {
      const { service, repository, audit } = createService();
      const renamed = { id: 'renamed', version: 3, name: 'Renamed', steps: [] };

      repository.findRevision.mockResolvedValue(createRow({ workflowId: 'old-family-uuid' }));
      repository.updateDraft.mockResolvedValue(
        createRow({ key: 'renamed', version: 3, name: 'Renamed' }),
      );

      await expect(service.update('flow', 1, renamed, OPERATOR)).resolves.toMatchObject({
        workflowId: 'renamed',
        version: 3,
        name: 'Renamed',
      });
      expect(repository.updateDraft).toHaveBeenCalledWith(
        manager,
        'version-uuid',
        'renamed',
        3,
        renamed,
        'Renamed',
      );
      expect(repository.deleteEmptyFamily).toHaveBeenCalledWith(manager, 'old-family-uuid');
      expect(audit.logWorkflowDraft).toHaveBeenCalledWith(manager, {
        action: 'workflow_draft.updated',
        actorId: OPERATOR,
        resourceId: 'version-uuid',
        metadata: {
          workflowId: 'renamed',
          version: 3,
          previousWorkflowId: 'flow',
          previousVersion: 1,
        },
      });
    });

    it('records a version change in the same family without deleting the family', async () => {
      const { service, repository, audit } = createService();

      repository.findRevision.mockResolvedValue(createRow());
      repository.listVersions.mockResolvedValue([createRow()]);
      repository.updateDraft.mockResolvedValue(createRow({ version: 4 }));

      await service.update('flow', 1, { id: 'flow', version: 4, steps: [] }, OPERATOR);

      expect(repository.deleteEmptyFamily).not.toHaveBeenCalled();
      expect(audit.logWorkflowDraft).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          metadata: {
            workflowId: 'flow',
            version: 4,
            previousWorkflowId: 'flow',
            previousVersion: 1,
          },
        }),
      );
    });

    it('answers 404 when the draft is not stored', async () => {
      const { service } = createService();

      await expect(service.update('flow', 1, document, OPERATOR)).rejects.toThrow(
        WorkflowNotFoundException,
      );
    });

    it('locks the draft row before reading it for the write', async () => {
      const { service, repository } = createService();

      repository.findRevision.mockResolvedValue(createRow());
      repository.updateDraft.mockResolvedValue(createRow());
      await service.update('flow', 1, document, OPERATOR);

      expect(repository.lockRevision).toHaveBeenCalledWith(manager, ACTIVE_SCOPES, 'flow', 1);
      expect(repository.lockRevision.mock.invocationCallOrder[0]).toBeLessThan(
        repository.findRevision.mock.invocationCallOrder[0],
      );
    });

    it('answers 404, not 500, when the row is gone by the time it is rewritten', async () => {
      const { service, repository, audit } = createService();

      repository.findRevision.mockResolvedValue(createRow());
      repository.updateDraft.mockResolvedValue(null);

      await expect(service.update('flow', 1, document, OPERATOR)).rejects.toThrow(
        WorkflowNotFoundException,
      );
      expect(audit.logWorkflowDraft).not.toHaveBeenCalled();
    });

    it('answers 409 and changes nothing for a published revision', async () => {
      const { service, repository, audit } = createService();

      repository.findRevision.mockResolvedValue(createRow({ status: 'published' }));

      await expect(service.update('flow', 1, document, OPERATOR)).rejects.toThrow(
        WorkflowVersionNotDraftException,
      );
      expect(repository.updateDraft).not.toHaveBeenCalled();
      expect(audit.logWorkflowDraft).not.toHaveBeenCalled();
    });

    it('refuses a draft an onboarding references', async () => {
      const { service, repository } = createService();

      repository.findRevision.mockResolvedValue(createRow());
      repository.countOnboardings.mockResolvedValue(2);

      await expect(service.update('flow', 1, document, OPERATOR)).rejects.toThrow(
        WorkflowDraftInUseException,
      );
      expect(repository.countOnboardings).toHaveBeenCalledWith(manager, 'version-uuid');
      expect(repository.updateDraft).not.toHaveBeenCalled();
    });

    it('refuses a target in another scope', async () => {
      const { service, repository } = createService();

      repository.findRevision.mockResolvedValue(createRow());
      repository.findFamily.mockResolvedValue({
        workflowId: 'uuid',
        key: 'shipped',
        scope: 'built-in',
      });

      await expect(
        service.update('flow', 1, { id: 'shipped', version: 1 }, OPERATOR),
      ).rejects.toThrow(WorkflowScopeConflictException);
    });

    it('refuses a target version that exists', async () => {
      const { service, repository } = createService();

      repository.findRevision.mockResolvedValue(createRow());
      repository.listVersions.mockResolvedValue([createRow({ key: 'other', version: 7 })]);

      await expect(
        service.update('flow', 1, { id: 'other', version: 7 }, OPERATOR),
      ).rejects.toThrow(WorkflowVersionExistsException);
    });

    it('refuses a move into a family that already holds a draft', async () => {
      const { service, repository } = createService();

      repository.findRevision.mockResolvedValue(createRow());
      repository.listVersions.mockResolvedValue([createRow({ key: 'other', version: 2 })]);

      await expect(
        service.update('flow', 1, { id: 'other', version: 3 }, OPERATOR),
      ).rejects.toThrow(WorkflowDraftExistsException);
    });

    it('maps a lost race on either constraint', async () => {
      const { service, repository } = createService();

      repository.findRevision.mockResolvedValue(createRow());
      repository.listVersions.mockResolvedValue([createRow()]);
      repository.updateDraft.mockRejectedValue(uniqueViolation(WORKFLOW_VERSION_CONSTRAINT));

      await expect(service.update('flow', 1, document, OPERATOR)).rejects.toThrow(
        WorkflowVersionExistsException,
      );
    });

    it('validates the new document before touching the store', async () => {
      const { service, repository } = createService();

      await expect(service.update('flow', 1, { id: 'flow' }, OPERATOR)).rejects.toThrow(
        WorkflowInvalidException,
      );
      expect(repository.findRevision).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the draft and its emptied family and audits it without a document', async () => {
      const { service, repository, audit } = createService();

      repository.findRevision.mockResolvedValue(createRow({ workflowId: 'family-uuid' }));

      await expect(service.remove('flow', 1, OPERATOR)).resolves.toBeUndefined();

      expect(repository.deleteDraft).toHaveBeenCalledWith(manager, 'version-uuid');
      expect(repository.deleteEmptyFamily).toHaveBeenCalledWith(manager, 'family-uuid');
      expect(audit.logWorkflowDraft).toHaveBeenCalledTimes(1);
      expect(audit.logWorkflowDraft).toHaveBeenCalledWith(manager, {
        action: 'workflow_draft.deleted',
        actorId: OPERATOR,
        resourceId: 'version-uuid',
        metadata: { workflowId: 'flow', version: 1 },
      });
    });

    it('locks the draft row before reading it, so a second delete finds it gone', async () => {
      const { service, repository, audit } = createService();

      repository.findRevision.mockResolvedValueOnce(createRow()).mockResolvedValueOnce(null);

      await service.remove('flow', 1, OPERATOR);
      await expect(service.remove('flow', 1, OPERATOR)).rejects.toThrow(WorkflowNotFoundException);

      expect(repository.lockRevision).toHaveBeenCalledTimes(2);
      expect(repository.lockRevision.mock.invocationCallOrder[0]).toBeLessThan(
        repository.findRevision.mock.invocationCallOrder[0],
      );
      expect(audit.logWorkflowDraft).toHaveBeenCalledTimes(1);
    });

    it('answers 404, 409 and in-use without deleting', async () => {
      const { service, repository, audit } = createService();

      await expect(service.remove('flow', 1, OPERATOR)).rejects.toThrow(WorkflowNotFoundException);

      repository.findRevision.mockResolvedValue(createRow({ status: 'retired' }));
      await expect(service.remove('flow', 1, OPERATOR)).rejects.toThrow(
        WorkflowVersionNotDraftException,
      );

      repository.findRevision.mockResolvedValue(createRow());
      repository.countOnboardings.mockResolvedValue(1);
      await expect(service.remove('flow', 1, OPERATOR)).rejects.toThrow(
        WorkflowDraftInUseException,
      );

      expect(repository.deleteDraft).not.toHaveBeenCalled();
      expect(audit.logWorkflowDraft).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    const setup = (draft = createRow({ version: 3 })) => {
      const context = createService();

      context.repository.findRevision.mockResolvedValue(draft);
      context.repository.publishDraft.mockResolvedValue(
        createRow({ version: 3, status: 'published', name: 'Stored label' }),
      );

      return context;
    };

    const expectNothingWritten = ({
      repository,
      audit,
    }: Pick<ReturnType<typeof createService>, 'repository' | 'audit'>) => {
      expect(repository.publishDraft).not.toHaveBeenCalled();
      expect(repository.relabelFamily).not.toHaveBeenCalled();
      expect(audit.logWorkflowDraft).not.toHaveBeenCalled();
    };

    it('compiles the stored definition, flips the row and audits identifiers only', async () => {
      const definition = { id: 'flow', version: 3, steps: [] };
      const context = setup(createRow({ version: 3, definition }));

      await expect(context.service.publish('flow', 3, OPERATOR)).resolves.toEqual({
        workflowId: 'flow',
        version: 3,
        status: 'published',
        name: 'Stored label',
        createdAt: new Date('2026-10-06T10:00:00Z'),
        updatedAt: new Date('2026-10-06T11:00:00Z'),
      });
      expect(context.compilation.compile).toHaveBeenCalledWith(definition, manager);
      expect(context.repository.publishDraft).toHaveBeenCalledWith(manager, 'version-uuid');
      expect(context.audit.logWorkflowDraft).toHaveBeenCalledTimes(1);
      expect(context.audit.logWorkflowDraft).toHaveBeenCalledWith(manager, {
        action: 'workflow_draft.published',
        actorId: OPERATOR,
        resourceId: 'version-uuid',
        metadata: { workflowId: 'flow', version: 3 },
      });
    });

    it('takes the advisory lock before the row lock', async () => {
      const { service, repository } = setup();

      await service.publish('flow', 3, OPERATOR);

      expect(repository.lockPublishing).toHaveBeenCalledWith(manager);
      expect(repository.lockPublishing.mock.invocationCallOrder[0]).toBeLessThan(
        repository.lockRevision.mock.invocationCallOrder[0],
      );
    });

    it('answers 404 and 409 NOT_DRAFT before anything else is checked', async () => {
      const context = createService();

      await expect(context.service.publish('flow', 3, OPERATOR)).rejects.toThrow(
        WorkflowNotFoundException,
      );

      context.repository.findRevision.mockResolvedValue(createRow({ status: 'published' }));
      await expect(context.service.publish('flow', 3, OPERATOR)).rejects.toThrow(
        WorkflowVersionNotDraftException,
      );

      expect(context.repository.findLatestPublished).not.toHaveBeenCalled();
      expect(context.compilation.compile).not.toHaveBeenCalled();
      expectNothingWritten(context);
    });

    it.each([
      ['equal to', 3],
      ['above', 5],
    ])('refuses a draft when a published version is %s it', async (_label, latestVersion) => {
      const context = setup();

      context.repository.findLatestPublished.mockResolvedValue(
        createRow({ version: latestVersion, status: 'published' }),
      );

      const failure = await context.service
        .publish('flow', 3, OPERATOR)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(WorkflowVersionNotLatestException);
      expect((failure as WorkflowVersionNotLatestException).getResponse()).toEqual({
        code: 'WORKFLOW_VERSION_NOT_LATEST',
        message: 'WORKFLOW_VERSION_NOT_LATEST',
        workflowId: 'flow',
        version: 3,
        latestPublishedVersion: latestVersion,
      });
      expect(context.compilation.compile).not.toHaveBeenCalled();
      expectNothingWritten(context);
    });

    it('answers 409 VERSION_EXISTS when a workflow file declares the same id and version', async () => {
      const context = setup();

      context.fileLoader.load.mockReturnValue([
        {
          scope: 'users',
          filePath: '/workflows/users/flow.json',
          workflowId: 'flow',
          version: 3,
          definition: { id: 'flow', version: 3, steps: [] },
        },
      ]);

      const failure = await context.service
        .publish('flow', 3, OPERATOR)
        .catch((error: unknown) => error);

      expect(context.fileLoader.load).toHaveBeenCalledWith(ACTIVE_SCOPES);
      expect(failure).toBeInstanceOf(WorkflowVersionExistsException);
      expect((failure as WorkflowVersionExistsException).getResponse()).toEqual({
        code: 'WORKFLOW_VERSION_EXISTS',
        message: 'WORKFLOW_VERSION_EXISTS',
        workflowId: 'flow',
        version: 3,
      });
      expect(context.compilation.compile).not.toHaveBeenCalled();
      expectNothingWritten(context);
    });

    it('publishes when workflow files declare only other versions of the family', async () => {
      const { service, fileLoader } = setup();

      fileLoader.load.mockReturnValue([
        {
          scope: 'users',
          filePath: '/workflows/users/flow.json',
          workflowId: 'flow',
          version: 2,
          definition: { id: 'flow', version: 2, steps: [] },
        },
      ]);

      await expect(service.publish('flow', 3, OPERATOR)).resolves.toMatchObject({ version: 3 });
    });

    it('publishes over a lower published version', async () => {
      const { service, repository } = setup();

      repository.findLatestPublished.mockResolvedValue(
        createRow({ version: 2, status: 'published' }),
      );

      await expect(service.publish('flow', 3, OPERATOR)).resolves.toMatchObject({ version: 3 });
    });

    it.each([
      ['an invalid document', new WorkflowInvalidException('INVALID_SHAPE')],
      ['a connector declaration', new WorkflowConnectorDeclarationInvalidException('step', 'bad')],
      ['a source key another family owns', new WorkflowSourceKeyConflictException('key', 'other')],
    ])('writes nothing when the compile reports %s', async (_label, error) => {
      const context = setup();

      context.compilation.compile.mockRejectedValue(error);

      await expect(context.service.publish('flow', 3, OPERATOR)).rejects.toBe(error);
      expectNothingWritten(context);
    });

    it('labels the family when the document names it and no non-draft version outranks it', async () => {
      const context = setup(
        createRow({ version: 3, definition: { id: 'flow', version: 3, name: 'New label' } }),
      );

      context.repository.listVersions.mockResolvedValue([
        createRow({ version: 3 }),
        createRow({ version: 2, status: 'published' }),
      ]);

      await expect(context.service.publish('flow', 3, OPERATOR)).resolves.toMatchObject({
        name: 'New label',
      });
      expect(context.repository.relabelFamily).toHaveBeenCalledWith(
        manager,
        'family-uuid',
        'New label',
      );
    });

    it('does not label when the document has no usable name', async () => {
      const { service, repository } = setup(
        createRow({ version: 3, definition: { id: 'flow', version: 3, name: '' } }),
      );

      await service.publish('flow', 3, OPERATOR);

      expect(repository.relabelFamily).not.toHaveBeenCalled();
    });

    it('does not label when a retired version of the family is higher', async () => {
      const { service, repository } = setup(
        createRow({ version: 3, definition: { id: 'flow', version: 3, name: 'New label' } }),
      );

      repository.listVersions.mockResolvedValue([
        createRow({ version: 4, status: 'retired' }),
        createRow({ version: 3, status: 'published' }),
      ]);

      await expect(service.publish('flow', 3, OPERATOR)).resolves.toMatchObject({
        name: 'Stored label',
      });
      expect(repository.relabelFamily).not.toHaveBeenCalled();
    });
  });
});
