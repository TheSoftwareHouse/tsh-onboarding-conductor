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
import { WorkflowsRepository } from './workflows.repository';

type WorkflowRevisions = {
  byVersion: Map<number, Workflow>;
  latest: Workflow;
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

    await this.workflowsRepository.saveFiles(manager, this.workflowFileLoaderService.load(scopes));

    const storedWorkflows = await this.workflowsRepository.findAll(manager, scopes);
    this.revisionsByWorkflowId = this.buildRevisions(storedWorkflows);

    if (this.revisionsByWorkflowId.size === 0) {
      this.logger.warn(
        `No workflows are available for scopes [${scopes.join(', ')}]; every onboarding start will fail with WORKFLOW_NOT_FOUND`,
      );
    }
  }

  /** Returns the pinned version when given one, otherwise the highest stored version. */
  getById(workflowId: string, version?: number): Workflow {
    const revisions = this.revisionsByWorkflowId.get(workflowId);
    if (!revisions) {
      throw new WorkflowNotFoundException();
    }

    if (version === undefined) {
      return revisions.latest;
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
      const revisions = revisionsByWorkflowId.get(workflow.id);

      if (!revisions) {
        revisionsByWorkflowId.set(workflow.id, {
          byVersion: new Map([[workflow.version, workflow]]),
          latest: workflow,
        });
        continue;
      }

      revisions.byVersion.set(workflow.version, workflow);

      if (workflow.version > revisions.latest.version) {
        revisions.latest = workflow;
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
