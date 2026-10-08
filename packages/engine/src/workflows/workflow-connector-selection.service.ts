import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { compileWorkflowReport, type NormalizedWorkflowDefinition } from '@tsh/ddl-schema';
import { AuditService } from '../audit/audit.service';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import { Workflow } from './domain/workflow';
import type { WorkflowStepConnectorWithFallbacksResponseDto } from './dto/workflow-definition.response.dto';
import { WorkflowVersionEntity } from './entity/workflow-version.entity';
import { WorkflowConnectorSelectionInvalidException } from './errors/workflow-connector-selection-invalid.exception';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowStepNotFoundException } from './errors/workflow-step-not-found.exception';
import { WorkflowConnectorSelectionsRepository } from './workflow-connector-selections.repository';
import { WorkflowRegistryService } from './workflow-registry.service';
import { PUBLISHED_WORKFLOW_STATUS, RETIRED_WORKFLOW_STATUS } from './workflow-status';
import { WorkflowsRepository } from './workflows.repository';

type SelectionCandidate = Readonly<{
  revision: WorkflowVersionEntity;
  definition: NormalizedWorkflowDefinition;
}>;

/**
 * The admin write behind `PUT`/`DELETE /v1/admin/workflows/:id/steps/:step/connector`: judges an
 * operator's choice of adapter by the registry's `ConnectorSelectionRules` against every stored
 * version it will apply to, then stores or drops it. The same rules build the projection, so what
 * this write refuses is never an id the read offered.
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

  /**
   * Binds the step's connector slot in every non-retired version of the family that declares the
   * step, and answers with the slot as the highest published version now projects it. The first
   * version to refuse the adapter ends the request, naming itself.
   */
  async select(
    key: string,
    stepName: string,
    connectorId: string,
    actorId: string | null,
  ): Promise<WorkflowStepConnectorWithFallbacksResponseDto> {
    const revisions = await this.findRevisions(key);
    const candidates = revisions
      .filter((revision) => revision.status !== RETIRED_WORKFLOW_STATUS)
      .map((revision): SelectionCandidate => ({
        revision,
        definition: this.workflowRegistryService.normalizeDefinition(revision.definition),
      }))
      .filter(({ definition }) => definition.stepsByName[stepName] !== undefined);

    if (candidates.length === 0) {
      throw new WorkflowStepNotFoundException(stepName);
    }

    const rules = this.workflowRegistryService.createConnectorSelectionRules();

    for (const { definition } of candidates) {
      const refusal = rules.refuse(definition.stepsByName[stepName], connectorId);

      if (refusal !== undefined) {
        throw new WorkflowConnectorSelectionInvalidException(
          stepName,
          connectorId,
          definition.version,
          refusal.reason,
          refusal.detail,
        );
      }
    }

    const workflowId = revisions[0].workflowId;
    const previous = await this.dataSource.transaction(async (manager) => {
      await this.selectionsRepository.lock(manager, workflowId, stepName);
      const stored = await this.selectionsRepository.find(manager, workflowId, stepName);
      await this.selectionsRepository.upsert(manager, workflowId, stepName, connectorId, actorId);

      return stored;
    });

    await this.auditService.logWorkflowChange(this.dataSource, {
      action: 'workflow.connector_selected',
      actorId: actorId ?? ADMIN_ACCESS_UNKNOWN_ACTOR,
      resourceId: key,
      metadata: {
        workflowId: key,
        stepName,
        previousConnectorId: previous?.connectorId ?? null,
        connectorId,
      },
    });

    const { revision, definition } =
      [...candidates]
        .reverse()
        .find(({ revision: candidate }) => candidate.status === PUBLISHED_WORKFLOW_STATUS) ??
      candidates[candidates.length - 1];
    const workflow = new Workflow(definition, undefined, revision.workflow.name, [
      { stepName, connectorId },
    ]);
    const projectedStep = workflow
      .describeDefinition(compileWorkflowReport(revision.definition).steps, rules)
      .steps.find((step) => step.name === stepName);

    return projectedStep.connectors[0];
  }

  /**
   * Returns the step to the connector its document authored. Clearing a step that has no
   * selection, or one no version declares, is a no-op that is still audited: only an unknown
   * family is a miss.
   */
  async clear(key: string, stepName: string, actorId: string | null): Promise<void> {
    const [{ workflowId }] = await this.findRevisions(key);
    const previous = await this.dataSource.transaction(async (manager) => {
      await this.selectionsRepository.lock(manager, workflowId, stepName);
      const stored = await this.selectionsRepository.find(manager, workflowId, stepName);
      await this.selectionsRepository.delete(manager, workflowId, stepName);

      return stored;
    });

    await this.auditService.logWorkflowChange(this.dataSource, {
      action: 'workflow.connector_selection_cleared',
      actorId: actorId ?? ADMIN_ACCESS_UNKNOWN_ACTOR,
      resourceId: key,
      metadata: {
        workflowId: key,
        stepName,
        previousConnectorId: previous?.connectorId ?? null,
        connectorId: null,
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
