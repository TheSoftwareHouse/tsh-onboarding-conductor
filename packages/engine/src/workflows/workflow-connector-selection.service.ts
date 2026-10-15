import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { NormalizedWorkflowDefinition } from '@tsh/ddl-schema';
import { AuditService } from '../audit/audit.service';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import {
  ALL_SELECTION_SCOPE,
  VERSION_SELECTION_SCOPE,
  findSelectableConnector,
} from './domain/connector-selection';
import type { WorkflowStepConnectorWithFallbacksResponseDto } from './dto/workflow-definition.response.dto';
import { WorkflowVersionEntity } from './entity/workflow-version.entity';
import { WorkflowConnectorSelectionInvalidException } from './errors/workflow-connector-selection-invalid.exception';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowRetiredException } from './errors/workflow-retired.exception';
import { WorkflowStepNotFoundException } from './errors/workflow-step-not-found.exception';
import { WorkflowVersionNotPublishedException } from './errors/workflow-version-not-published.exception';
import { WorkflowConnectorSelectionsRepository } from './workflow-connector-selections.repository';
import { WorkflowRegistryService } from './workflow-registry.service';
import { PUBLISHED_WORKFLOW_STATUS, RETIRED_WORKFLOW_STATUS } from './workflow-status';
import { WorkflowsRepository } from './workflows.repository';

/** Which versions a write reaches. */
export type ConnectorSelectionTarget =
  | Readonly<{ scope: typeof VERSION_SELECTION_SCOPE; version: number }>
  | Readonly<{ scope: typeof ALL_SELECTION_SCOPE }>;

type SelectionCandidate = Readonly<{
  revision: WorkflowVersionEntity;
  definition: NormalizedWorkflowDefinition;
}>;

type SelectionAudit = Readonly<{
  action: 'workflow.connector_selected' | 'workflow.connector_selection_cleared';
  key: string;
  stepName: string;
  connectorId: string | null;
  target: ConnectorSelectionTarget;
  versions: number[];
  stored: { version: number; connectorId: string }[];
  actorId: string | null;
}>;

/**
 * The admin write behind `PUT`/`DELETE /v1/admin/workflows/:id/steps/:step/connector`: judges an
 * operator's choice of adapter by the registry's `ConnectorSelectionRules` against the published
 * versions it will apply to, then stores or drops it per version. The same rules build the
 * projection, so what this write refuses is never an id the read offered.
 */
@Injectable()
export class WorkflowConnectorSelectionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly workflowsRepository: WorkflowsRepository,
    private readonly selectionsRepository: WorkflowConnectorSelectionsRepository,
    private readonly workflowRegistryService: WorkflowRegistryService,
    private readonly auditService: AuditService,
  ) {}

  /** Binds the step's connector slot on the targeted versions, all or nothing. */
  async select(
    key: string,
    stepName: string,
    connectorId: string,
    target: ConnectorSelectionTarget,
    actorId: string | null,
  ): Promise<WorkflowStepConnectorWithFallbacksResponseDto> {
    const revisions = await this.findRevisions(key);
    const { declaring, targets } = this.resolveTargets(key, revisions, stepName, target);
    const rules = this.workflowRegistryService.createConnectorSelectionRules();

    // Only `all` can reach here empty: every declaring version has no single connector to bind.
    for (const { revision, definition } of targets.length === 0 ? declaring.slice(-1) : targets) {
      const refusal = rules.refuse(definition.stepsByName[stepName], connectorId);

      if (refusal !== undefined) {
        throw new WorkflowConnectorSelectionInvalidException(
          stepName,
          connectorId,
          revision.version,
          refusal.reason,
          refusal.detail,
        );
      }
    }

    const workflowId = revisions[0].workflowId;
    const versions = targets.map(({ revision }) => revision.version);
    const stored = await this.dataSource.transaction(async (manager) => {
      await this.selectionsRepository.lock(manager, workflowId, stepName);
      const previous = await this.selectionsRepository.findForStep(
        manager,
        workflowId,
        stepName,
        versions,
      );

      for (const version of versions) {
        await this.selectionsRepository.upsert(
          manager,
          workflowId,
          version,
          stepName,
          connectorId,
          actorId,
        );
      }

      return previous;
    });

    await this.audit({
      action: 'workflow.connector_selected',
      key,
      stepName,
      connectorId,
      target,
      versions,
      stored,
      actorId,
    });

    const projection = await this.workflowRegistryService.describeForAdmin(
      key,
      versions[versions.length - 1],
    );

    return projection.steps.find((step) => step.name === stepName).connectors[0];
  }

  /** Returns the step to its authored connector on the targeted versions; a no-op is still audited. */
  async clear(
    key: string,
    stepName: string,
    target: ConnectorSelectionTarget,
    actorId: string | null,
  ): Promise<void> {
    const revisions = await this.findRevisions(key);
    const { targets } = this.resolveTargets(key, revisions, stepName, target);
    const workflowId = revisions[0].workflowId;
    const versions = targets.map(({ revision }) => revision.version);
    const stored = await this.dataSource.transaction(async (manager) => {
      await this.selectionsRepository.lock(manager, workflowId, stepName);
      const previous = await this.selectionsRepository.findForStep(
        manager,
        workflowId,
        stepName,
        versions,
      );
      await this.selectionsRepository.delete(manager, workflowId, stepName, versions);

      return previous;
    });

    await this.audit({
      action: 'workflow.connector_selection_cleared',
      key,
      stepName,
      connectorId: null,
      target,
      versions,
      stored,
      actorId,
    });
  }

  /** The published versions a write reaches; `targets` keeps those whose step has one connector. */
  private resolveTargets(
    key: string,
    revisions: WorkflowVersionEntity[],
    stepName: string,
    target: ConnectorSelectionTarget,
  ): { declaring: SelectionCandidate[]; targets: SelectionCandidate[] } {
    const candidates =
      target.scope === VERSION_SELECTION_SCOPE
        ? revisions.filter(({ version }) => version === target.version)
        : revisions.filter(({ status }) => status === PUBLISHED_WORKFLOW_STATUS);

    if (target.scope === VERSION_SELECTION_SCOPE) {
      if (candidates.length === 0) {
        throw new WorkflowNotFoundException();
      }

      if (candidates[0].status === RETIRED_WORKFLOW_STATUS) {
        throw new WorkflowRetiredException();
      }

      if (candidates[0].status !== PUBLISHED_WORKFLOW_STATUS) {
        throw new WorkflowVersionNotPublishedException(key, target.version);
      }
    }

    const declaring = candidates
      .map((revision): SelectionCandidate => ({
        revision,
        definition: this.workflowRegistryService.normalizeDefinition(revision.definition),
      }))
      .filter(({ definition }) => definition.stepsByName[stepName] !== undefined);

    if (declaring.length === 0) {
      throw new WorkflowStepNotFoundException(stepName);
    }

    return {
      declaring,
      targets:
        target.scope === ALL_SELECTION_SCOPE
          ? declaring.filter(
              ({ definition }) =>
                findSelectableConnector(definition.stepsByName[stepName]) !== undefined,
            )
          : declaring,
    };
  }

  private async audit(entry: SelectionAudit): Promise<void> {
    const previousByVersion = new Map(entry.stored.map((row) => [row.version, row.connectorId]));

    await this.auditService.logWorkflowChange(this.dataSource, {
      action: entry.action,
      actorId: entry.actorId ?? ADMIN_ACCESS_UNKNOWN_ACTOR,
      resourceId: entry.key,
      metadata: {
        workflowId: entry.key,
        stepName: entry.stepName,
        connectorId: entry.connectorId,
        scope: entry.target.scope,
        versions: entry.versions.map((version) => ({
          version,
          previousConnectorId: previousByVersion.get(version) ?? null,
        })),
      },
    });
  }

  private async findRevisions(key: string): Promise<WorkflowVersionEntity[]> {
    const revisions = await this.workflowsRepository.findRevisions(
      this.dataSource.manager,
      this.workflowRegistryService.getActiveScopes(),
      key,
    );

    if (revisions.length === 0) {
      throw new WorkflowNotFoundException();
    }

    return revisions;
  }
}
