import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { validateAndNormalizeWorkflow, WorkflowInvalidError } from '@tsh/ddl-schema';
import {
  WORKFLOW_CONNECTOR_EXECUTION_PORT,
  type ConnectorExecutionPort,
} from '../connectors/ports/connector-execution.port';
import { Workflow } from './domain/workflow';
import { WorkflowEntity } from './entity/workflow.entity';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowFileLoaderService } from './workflow-file-loader.service';
import { WORKFLOW_SCOPES, type WorkflowScope } from './workflow-scope';
import { PUBLISHED_WORKFLOW_STATUS } from './workflow-status';
import { WorkflowsRepository } from './workflows.repository';

type WorkflowRevisions = {
  byVersion: Map<number, Workflow>;
  latestPublished?: Workflow;
};

const PRODUCTION_NODE_ENV = 'production';

@Injectable()
export class WorkflowRegistryService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowRegistryService.name);

  private revisionsByWorkflowId: ReadonlyMap<string, WorkflowRevisions> = new Map();

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly workflowFileLoaderService: WorkflowFileLoaderService,
    private readonly workflowsRepository: WorkflowsRepository,
    @Inject(WORKFLOW_CONNECTOR_EXECUTION_PORT)
    @Optional()
    private readonly connectorExecutionPort?: ConnectorExecutionPort,
  ) {}

  /**
   * Files are only the definition source: they are validated and published into
   * the `workflows` table once at startup, and everything served afterwards
   * comes back out of that table.
   */
  async onModuleInit(): Promise<void> {
    const scopes = this.getActiveScopes();
    const manager = this.dataSource.manager;

    await this.workflowsRepository.upsertFromFiles(
      manager,
      this.workflowFileLoaderService.load(scopes),
    );

    const storedWorkflows = await this.workflowsRepository.findAll(manager, scopes);
    this.revisionsByWorkflowId = this.buildRevisions(storedWorkflows);

    const hasPublishedRevision = [...this.revisionsByWorkflowId.values()].some(
      (revisions) => revisions.latestPublished !== undefined,
    );

    if (!hasPublishedRevision) {
      this.logger.warn(
        `No published workflows are available for scopes [${scopes.join(', ')}]; every onboarding start will fail with WORKFLOW_NOT_FOUND`,
      );
    }
  }

  /**
   * Returns the pinned version when given one, otherwise the highest published
   * one. A pinned lookup deliberately ignores `status`: onboardings already
   * running on a revision must keep resolving it after it stops being the
   * published one, and a draft has to be resolvable to be tried out at all.
   */
  getById(workflowId: string, version?: number): Workflow {
    const revisions = this.revisionsByWorkflowId.get(workflowId);
    if (!revisions) {
      throw new WorkflowNotFoundException();
    }

    if (version === undefined) {
      if (!revisions.latestPublished) {
        throw new WorkflowNotFoundException();
      }

      return revisions.latestPublished;
    }

    const workflow = revisions.byVersion.get(version);
    if (!workflow) {
      throw new WorkflowInvalidError('INVALID_VALUE');
    }

    return workflow;
  }

  private buildRevisions(
    storedWorkflows: readonly WorkflowEntity[],
  ): ReadonlyMap<string, WorkflowRevisions> {
    const revisionsByWorkflowId = new Map<string, WorkflowRevisions>();

    for (const storedWorkflow of storedWorkflows) {
      const definition = validateAndNormalizeWorkflow(storedWorkflow.definition);

      for (const step of definition.steps) {
        this.connectorExecutionPort?.validateDeclarations?.(step.connectors);
      }

      const workflow = new Workflow(definition, this.connectorExecutionPort);
      let revisions = revisionsByWorkflowId.get(workflow.id);

      if (!revisions) {
        revisions = { byVersion: new Map() };
        revisionsByWorkflowId.set(workflow.id, revisions);
      }

      revisions.byVersion.set(workflow.version, workflow);

      if (
        storedWorkflow.status === PUBLISHED_WORKFLOW_STATUS &&
        workflow.version > (revisions.latestPublished?.version ?? 0)
      ) {
        revisions.latestPublished = workflow;
      }
    }

    return revisionsByWorkflowId;
  }

  /** Fixture workflows are development and CI scaffolding and never ship to production. */
  private getActiveScopes(): readonly WorkflowScope[] {
    if (this.configService.get<string>('NODE_ENV') === PRODUCTION_NODE_ENV) {
      return WORKFLOW_SCOPES.filter((scope) => scope !== 'fixtures');
    }

    return WORKFLOW_SCOPES;
  }
}
