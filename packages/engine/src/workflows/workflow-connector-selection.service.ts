import { Inject, Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  compileWorkflowReport,
  type NormalizedWorkflowDefinition,
  type NormalizedWorkflowStep,
} from '@tsh/ddl-schema';
import { AuditService } from '../audit/audit.service';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import {
  WORKFLOW_CONNECTOR_EXECUTION_PORT,
  type ConnectorExecutionPort,
} from '../connectors/ports/connector-execution.port';
import { Workflow } from './domain/workflow';
import { findSelectableConnector } from './domain/connector-selection';
import type { WorkflowStepConnectorWithFallbacksResponseDto } from './dto/workflow-definition.response.dto';
import { WorkflowVersionEntity } from './entity/workflow-version.entity';
import {
  WorkflowConnectorSelectionInvalidException,
  type WorkflowConnectorSelectionInvalidReason,
} from './errors/workflow-connector-selection-invalid.exception';
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
 * The admin write behind `PUT`/`DELETE /v1/admin/workflows/:id/steps/:step/connector`: validates
 * an operator's choice of adapter against every stored version it will apply to, then stores or
 * drops it. Injects the connector execution port only — the adapter collection and scopes tokens
 * would close a module cycle, and the port's `listAdapters()` is the seam built for this.
 */
@Injectable()
export class WorkflowConnectorSelectionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly workflowsRepository: WorkflowsRepository,
    private readonly selectionsRepository: WorkflowConnectorSelectionsRepository,
    private readonly workflowRegistryService: WorkflowRegistryService,
    private readonly auditService: AuditService,
    @Inject(WORKFLOW_CONNECTOR_EXECUTION_PORT)
    @Optional()
    private readonly connectorExecutionPort?: ConnectorExecutionPort,
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

    for (const { definition } of candidates) {
      this.assertSelectable(definition.stepsByName[stepName], connectorId, definition.version);
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
    const workflow = new Workflow(definition, this.connectorExecutionPort, revision.workflow.name, [
      { stepName, connectorId },
    ]);
    const projectedStep = workflow
      .describeDefinition(
        compileWorkflowReport(revision.definition).steps,
        this.workflowRegistryService.listSelectableAdapters(),
      )
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

  /** Throws for the first reason this version's step cannot run the adapter in its slot. */
  private assertSelectable(
    step: NormalizedWorkflowStep,
    connectorId: string,
    workflowVersion: number,
  ): void {
    const refuse = (reason: WorkflowConnectorSelectionInvalidReason, detail?: string): never => {
      throw new WorkflowConnectorSelectionInvalidException(
        step.name,
        connectorId,
        workflowVersion,
        reason,
        detail,
      );
    };
    const slot = findSelectableConnector(step);

    if (slot === undefined) {
      return refuse(step.connectors.length === 0 ? 'no_connector' : 'multiple_connectors');
    }

    if (slot.fallbacks.some((fallback) => fallback.id === connectorId)) {
      return refuse('in_fallback_chain');
    }

    const adapter = this.connectorExecutionPort
      ?.listAdapters?.()
      .find((candidate) => candidate.id === connectorId);

    if (adapter === undefined) {
      return refuse('adapter_not_registered');
    }

    if (
      !this.workflowRegistryService
        .listSelectableAdapters()
        .some((candidate) => candidate.id === connectorId)
    ) {
      return refuse('fixture_not_allowed');
    }

    if (adapter.type !== slot.type) {
      return refuse('type_mismatch');
    }

    if (slot.async && !adapter.supportsAsyncCallback) {
      return refuse('async_unsupported');
    }

    const missingField = adapter.callbackFields.find(
      (field) => !Object.prototype.hasOwnProperty.call(step.data, field),
    );

    if (missingField !== undefined) {
      return refuse('callback_fields_missing', `the step does not declare "${missingField}"`);
    }

    try {
      this.connectorExecutionPort.validateDeclarations?.([{ ...slot, id: connectorId }]);
    } catch (cause) {
      return refuse('declaration_invalid', cause instanceof Error ? cause.message : String(cause));
    }
  }
}
