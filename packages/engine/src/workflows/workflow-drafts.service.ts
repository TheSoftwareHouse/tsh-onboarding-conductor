import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { isUniqueViolation } from '../database/unique-violation';
import type { AdminWorkflowDraftResponseDto } from './dto/admin-workflow-draft.response.dto';
import type { AdminWorkflowPublicationResponseDto } from './dto/admin-workflow-publication.response.dto';
import type { AdminWorkflowVersionDocumentResponseDto } from './dto/admin-workflow-version-document.response.dto';
import { MAX_WORKFLOW_VERSION } from './dto/workflow-version.params.dto';
import type { WorkflowVersionEntity } from './entity/workflow-version.entity';
import { WorkflowDraftExistsException } from './errors/workflow-draft-exists.exception';
import { WorkflowDraftInUseException } from './errors/workflow-draft-in-use.exception';
import { WorkflowInvalidException } from './errors/workflow-invalid.exception';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowScopeConflictException } from './errors/workflow-scope-conflict.exception';
import { WorkflowVersionExistsException } from './errors/workflow-version-exists.exception';
import { WorkflowVersionNotDraftException } from './errors/workflow-version-not-draft.exception';
import { WorkflowVersionNotLatestException } from './errors/workflow-version-not-latest.exception';
import { WorkflowCompilationService } from './workflow-compilation.service';
import { WorkflowFileLoaderService } from './workflow-file-loader.service';
import { WorkflowRegistryService } from './workflow-registry.service';
import { DRAFT_WORKFLOW_STATUS } from './workflow-status';
import { DRAFT_FAMILY_SCOPE, WorkflowsRepository } from './workflows.repository';

/** The `workflows.key` column width; an `id` longer than this cannot name a family. */
const MAX_WORKFLOW_ID_LENGTH = 100;

/** The `workflows.name` column width, and the authored schema's bound for a `name`. */
const MAX_WORKFLOW_NAME_LENGTH = 200;

/** The constraint that holds one row per family and version. */
const WORKFLOW_VERSION_CONSTRAINT = 'uq_workflow_versions_workflow_version';

/** The partial index that holds one draft per family. */
const ONE_DRAFT_CONSTRAINT = 'uq_workflow_versions_one_draft';

/** What a save needs from a document: where it goes, and the label that may name a new family. */
type DraftIdentity = { id: string; version: number; name?: string };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Authoring drafts: the draft rows an operator creates, edits and deletes through the admin API.
 * A save checks only where the document lands, never whether it compiles; the compile dry run
 * tells the author that. Every write is one transaction together with its audit row.
 */
@Injectable()
export class WorkflowDraftsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly workflowsRepository: WorkflowsRepository,
    private readonly workflowRegistryService: WorkflowRegistryService,
    private readonly workflowCompilationService: WorkflowCompilationService,
    private readonly workflowFileLoaderService: WorkflowFileLoaderService,
    private readonly auditService: AuditService,
  ) {}

  async create(document: unknown, operator: string): Promise<AdminWorkflowDraftResponseDto> {
    const { id, version, name } = this.parseIdentity(document);

    const draft = await this.write(id, version, async (manager) => {
      await this.assertTargetFree(manager, id, version);

      const created = await this.workflowsRepository.insertDraft(
        manager,
        id,
        version,
        document as Record<string, unknown>,
        name,
      );

      await this.auditService.logWorkflowDraft(manager, {
        action: 'workflow_draft.created',
        actorId: operator,
        resourceId: created.workflowVersionId,
        metadata: { workflowId: id, version },
      });

      return created;
    });

    return this.toResponse(draft);
  }

  async getDocument(
    workflowId: string,
    version: number,
  ): Promise<AdminWorkflowVersionDocumentResponseDto> {
    const revision = await this.workflowsRepository.findRevision(
      this.dataSource.manager,
      this.workflowRegistryService.getActiveScopes(),
      workflowId,
      version,
    );

    if (revision === null) {
      throw new WorkflowNotFoundException();
    }

    return { ...this.toResponse(revision), document: revision.definition };
  }

  async update(
    workflowId: string,
    version: number,
    document: unknown,
    operator: string,
  ): Promise<AdminWorkflowDraftResponseDto> {
    const target = this.parseIdentity(document);

    const draft = await this.write(target.id, target.version, async (manager) => {
      const current = await this.getDraft(manager, workflowId, version, true);

      await this.assertNotInUse(manager, current);
      await this.assertTargetFree(manager, target.id, target.version, current);

      const updated = await this.workflowsRepository.updateDraft(
        manager,
        current.workflowVersionId,
        target.id,
        target.version,
        document as Record<string, unknown>,
        target.name,
      );

      if (updated === null) {
        throw new WorkflowNotFoundException();
      }

      const moved = target.id !== workflowId || target.version !== version;

      if (target.id !== workflowId) {
        await this.workflowsRepository.deleteEmptyFamily(manager, current.workflowId);
      }

      await this.auditService.logWorkflowDraft(manager, {
        action: 'workflow_draft.updated',
        actorId: operator,
        resourceId: current.workflowVersionId,
        metadata: {
          workflowId: target.id,
          version: target.version,
          ...(moved ? { previousWorkflowId: workflowId, previousVersion: version } : {}),
        },
      });

      return updated;
    });

    return this.toResponse(draft);
  }

  async remove(workflowId: string, version: number, operator: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const current = await this.getDraft(manager, workflowId, version, true);

      await this.assertNotInUse(manager, current);
      await this.workflowsRepository.deleteDraft(manager, current.workflowVersionId);
      await this.workflowsRepository.deleteEmptyFamily(manager, current.workflowId);
      await this.auditService.logWorkflowDraft(manager, {
        action: 'workflow_draft.deleted',
        actorId: operator,
        resourceId: current.workflowVersionId,
        metadata: { workflowId, version },
      });
    });
  }

  /** Makes the stored draft the family's latest published version; see ADR 0040. */
  async publish(
    workflowId: string,
    version: number,
    operator: string,
  ): Promise<AdminWorkflowPublicationResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      await this.workflowsRepository.lockPublishing(manager);

      const draft = await this.getDraft(manager, workflowId, version, true);
      const latest = await this.workflowsRepository.findLatestPublished(
        manager,
        this.workflowRegistryService.getActiveScopes(),
        workflowId,
      );

      if (latest !== null && latest.version >= version) {
        throw new WorkflowVersionNotLatestException(workflowId, version, latest.version);
      }

      // Boot skips a file shadowing a draft, but would refuse it against a published row.
      const isShadowed = this.workflowFileLoaderService
        .load(this.workflowRegistryService.getActiveScopes())
        .some((file) => file.workflowId === workflowId && file.version === version);

      if (isShadowed) {
        throw new WorkflowVersionExistsException(workflowId, version);
      }

      await this.workflowCompilationService.compile(draft.definition, manager);

      const published = await this.workflowsRepository.publishDraft(
        manager,
        draft.workflowVersionId,
      );

      if (published === null) {
        throw new WorkflowNotFoundException();
      }

      const label = await this.relabel(manager, draft);

      await this.auditService.logWorkflowDraft(manager, {
        action: 'workflow_draft.published',
        actorId: operator,
        resourceId: published.workflowVersionId,
        metadata: { workflowId, version },
      });

      return { ...this.toResponse(published), name: label ?? published.workflow.name ?? null };
    });
  }

  /** Writes the document's `name` to the family unless a non-draft revision outranks this one; returns what it wrote. */
  private async relabel(
    manager: EntityManager,
    draft: WorkflowVersionEntity,
  ): Promise<string | undefined> {
    const { name } = this.parseIdentity(draft.definition);

    if (name === undefined) {
      return undefined;
    }

    const isOutranked = (await this.listFamily(manager, draft.workflow.key)).some(
      (stored) => stored.status !== DRAFT_WORKFLOW_STATUS && stored.version > draft.version,
    );

    if (isOutranked) {
      return undefined;
    }

    await this.workflowsRepository.relabelFamily(manager, draft.workflowId, name);

    return name;
  }

  /**
   * Runs one write transaction and maps the unique violation the pre-checks lost a race to. The
   * mapping happens after the rollback, because a failed transaction answers no further queries.
   */
  private async write<TResult>(
    id: string,
    version: number,
    work: (manager: EntityManager) => Promise<TResult>,
  ): Promise<TResult> {
    try {
      return await this.dataSource.transaction(work);
    } catch (error) {
      if (isUniqueViolation(error, WORKFLOW_VERSION_CONSTRAINT)) {
        throw new WorkflowVersionExistsException(id, version);
      }

      if (isUniqueViolation(error, ONE_DRAFT_CONSTRAINT)) {
        const [draft] = (await this.listFamily(this.dataSource.manager, id)).filter(
          ({ status }) => status === DRAFT_WORKFLOW_STATUS,
        );

        throw new WorkflowDraftExistsException(id, draft?.version);
      }

      throw error;
    }
  }

  /** The draft at `(workflowId, version)`, row-locked when `lock`: 404 when no such row is visible, 409 when it is not a draft. */
  private async getDraft(
    manager: EntityManager,
    workflowId: string,
    version: number,
    lock = false,
  ): Promise<WorkflowVersionEntity> {
    const scopes = this.workflowRegistryService.getActiveScopes();

    if (lock) {
      await this.workflowsRepository.lockRevision(manager, scopes, workflowId, version);
    }

    const revision = await this.workflowsRepository.findRevision(
      manager,
      scopes,
      workflowId,
      version,
    );

    if (revision === null) {
      throw new WorkflowNotFoundException();
    }

    if (revision.status !== DRAFT_WORKFLOW_STATUS) {
      throw new WorkflowVersionNotDraftException(workflowId, version, revision.status);
    }

    return revision;
  }

  private async assertNotInUse(
    manager: EntityManager,
    draft: WorkflowVersionEntity,
  ): Promise<void> {
    if ((await this.workflowsRepository.countOnboardings(manager, draft.workflowVersionId)) > 0) {
      throw new WorkflowDraftInUseException(draft.workflow.key, draft.version);
    }
  }

  /** The target `(id, version)` must sit in a `users` family, be unused, and not be a second draft. */
  private async assertTargetFree(
    manager: EntityManager,
    id: string,
    version: number,
    moving?: WorkflowVersionEntity,
  ): Promise<void> {
    const family = await this.workflowsRepository.findFamily(manager, id);

    if (family !== null && family.scope !== DRAFT_FAMILY_SCOPE) {
      throw new WorkflowScopeConflictException(id, family.scope);
    }

    const others = (await this.listFamily(manager, id)).filter(
      (stored) => stored.version !== moving?.version || id !== moving?.workflow.key,
    );

    if (others.some((stored) => stored.version === version)) {
      throw new WorkflowVersionExistsException(id, version);
    }

    const existingDraft = others.find(({ status }) => status === DRAFT_WORKFLOW_STATUS);

    if (existingDraft !== undefined) {
      throw new WorkflowDraftExistsException(id, existingDraft.version);
    }
  }

  private listFamily(manager: EntityManager, id: string): Promise<WorkflowVersionEntity[]> {
    return this.workflowsRepository.listVersions(
      manager,
      this.workflowRegistryService.getActiveScopes(),
      id,
    );
  }

  /** The save precondition: an object whose `id` can name a family and whose `version` fits the column. */
  private parseIdentity(document: unknown): DraftIdentity {
    if (!isPlainObject(document)) {
      throw new WorkflowInvalidException('INVALID_SHAPE');
    }

    const { id, version, name } = document;

    if (typeof id !== 'string' || id.length < 1 || id.length > MAX_WORKFLOW_ID_LENGTH) {
      throw new WorkflowInvalidException('INVALID_SHAPE', 'id');
    }

    if (
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < 1 ||
      version > MAX_WORKFLOW_VERSION
    ) {
      throw new WorkflowInvalidException('INVALID_SHAPE', 'version');
    }

    const hasLabel =
      typeof name === 'string' && name.length >= 1 && name.length <= MAX_WORKFLOW_NAME_LENGTH;

    return { id, version, name: hasLabel ? name : undefined };
  }

  private toResponse(draft: WorkflowVersionEntity): AdminWorkflowDraftResponseDto {
    return {
      workflowId: draft.workflow.key,
      version: draft.version,
      status: draft.status,
      name: draft.workflow.name ?? null,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
  }
}
