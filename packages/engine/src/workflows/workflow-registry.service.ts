import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { validateAndNormalizeWorkflow, type NormalizedWorkflowDefinition } from '@tsh/ddl-schema';
import {
  WORKFLOW_CONNECTOR_EXECUTION_PORT,
  type ConnectorExecutionPort,
} from '../connectors/ports/connector-execution.port';
import { Workflow } from './domain/workflow';
import { WorkflowEntity } from './entity/workflow.entity';
import { DuplicateWorkflowSourceKeyError } from './errors/duplicate-workflow-source-key.error';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowRetiredException } from './errors/workflow-retired.exception';
import { WorkflowRevisionNotFoundError } from './errors/workflow-revision-not-found.error';
import { WorkflowFileLoaderService } from './workflow-file-loader.service';
import { WORKFLOW_SCOPES, type WorkflowScope } from './workflow-scope';
import { RETIRED_WORKFLOW_STATUS } from './workflow-status';
import { WorkflowsRepository } from './workflows.repository';

const PRODUCTION_NODE_ENV = 'production';

type SourceKeyDeclaration = { readonly workflowId: string; readonly sourceKey: string };

@Injectable()
export class WorkflowRegistryService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowRegistryService.name);

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
   * the `workflows` table once at startup. Nothing is cached from here on — the
   * table is the read model, so a revision edited, drafted or retired from the
   * admin UI takes effect on the next request instead of the next deploy, and
   * every instance of the engine serves the same answer.
   */
  async onModuleInit(): Promise<void> {
    const scopes = this.getActiveScopes();
    const manager = this.dataSource.manager;

    await this.workflowsRepository.upsertFromFiles(
      manager,
      this.workflowFileLoaderService.load(scopes),
    );

    const storedWorkflows = await this.workflowsRepository.findAll(manager, scopes);
    const sourceKeyDeclarations: SourceKeyDeclaration[] = [];

    for (const storedWorkflow of storedWorkflows) {
      const definition = this.normalizeStoredWorkflow(storedWorkflow);

      new Workflow(definition, this.connectorExecutionPort);

      sourceKeyDeclarations.push(...this.collectSourceKeys(storedWorkflow.workflowId, definition));
    }

    this.assertUniqueSourceKeys(sourceKeyDeclarations);

    if ((await this.workflowsRepository.countPublished(manager, scopes)) === 0) {
      this.logger.warn(
        `No published workflows are available for scopes [${scopes.join(', ')}]; every onboarding start will fail with WORKFLOW_NOT_FOUND`,
      );
    }
  }

  /**
   * Returns the pinned revision when given one, otherwise the highest published
   * one. A pinned lookup deliberately ignores `draft`: an onboarding already
   * running on a revision must keep resolving it after it stops being the
   * published one, and a draft has to be resolvable to be tried out at all. It
   * does not ignore `retired`, which is the point of that status — a
   * discontinued revision is refused for pinned and unpinned lookups alike, so
   * in-flight onboardings stop too.
   *
   * Pass `manager` to read inside a caller's transaction; without it the read
   * uses the default connection.
   */
  async getById(workflowId: string, version?: number, manager?: EntityManager): Promise<Workflow> {
    const scopes = this.getActiveScopes();
    const readManager = manager ?? this.dataSource.manager;

    if (version === undefined) {
      const latestPublished = await this.workflowsRepository.findLatestPublished(
        readManager,
        scopes,
        workflowId,
      );

      if (!latestPublished) {
        throw new WorkflowNotFoundException();
      }

      return this.toWorkflow(latestPublished);
    }

    const storedWorkflow = await this.workflowsRepository.findRevision(
      readManager,
      scopes,
      workflowId,
      version,
    );

    if (!storedWorkflow) {
      throw await this.pinnedLookupFailure(readManager, scopes, workflowId, version);
    }

    if (storedWorkflow.status === RETIRED_WORKFLOW_STATUS) {
      throw new WorkflowRetiredException();
    }

    return this.toWorkflow(storedWorkflow);
  }

  /**
   * An unknown id and a known id pinned to an unknown version are different
   * mistakes and report differently, so the miss is attributed before it throws.
   */
  private async pinnedLookupFailure(
    manager: EntityManager,
    scopes: readonly WorkflowScope[],
    workflowId: string,
    version: number,
  ): Promise<Error> {
    const revisionCount = await this.workflowsRepository.countRevisions(
      manager,
      scopes,
      workflowId,
    );

    return revisionCount > 0
      ? new WorkflowRevisionNotFoundError(workflowId, version)
      : new WorkflowNotFoundException();
  }

  private toWorkflow(storedWorkflow: WorkflowEntity): Workflow {
    return new Workflow(this.normalizeStoredWorkflow(storedWorkflow), this.connectorExecutionPort);
  }

  private normalizeStoredWorkflow(storedWorkflow: WorkflowEntity): NormalizedWorkflowDefinition {
    const definition = validateAndNormalizeWorkflow(storedWorkflow.definition);

    for (const step of definition.steps) {
      this.connectorExecutionPort?.validateDeclarations?.(step.connectors);
    }

    return definition;
  }

  /**
   * `sourceKey` is declared per connector, but must be unique per workflow document, not per
   * connector or per step: the same key repeated on two connector declarations within one
   * document is legal. Generic over connector id — the rule does not special-case any one
   * connector type.
   */
  private collectSourceKeys(
    workflowId: string,
    definition: NormalizedWorkflowDefinition,
  ): SourceKeyDeclaration[] {
    const declarations: SourceKeyDeclaration[] = [];

    for (const step of definition.steps) {
      for (const connector of step.connectors) {
        const sourceKey = this.readSourceKey(connector.config);
        if (sourceKey !== undefined) {
          declarations.push({ workflowId, sourceKey });
        }
      }
    }

    return declarations;
  }

  /**
   * This is the only place holding every stored workflow's declarations at once, so it is the
   * only place the cross-document uniqueness rule can be enforced. It runs over the full set
   * collected across the startup sweep, so a collision between the first and the last document is
   * caught exactly like one between any other pair.
   */
  private assertUniqueSourceKeys(declarations: readonly SourceKeyDeclaration[]): void {
    const workflowIdBySourceKey = new Map<string, string>();

    for (const { workflowId, sourceKey } of declarations) {
      const existingWorkflowId = workflowIdBySourceKey.get(sourceKey);

      if (existingWorkflowId !== undefined && existingWorkflowId !== workflowId) {
        throw new DuplicateWorkflowSourceKeyError(existingWorkflowId, workflowId, sourceKey);
      }

      workflowIdBySourceKey.set(sourceKey, workflowId);
    }
  }

  private readSourceKey(config: Readonly<Record<string, unknown>>): string | undefined {
    const { sourceKey } = config;

    if (typeof sourceKey !== 'string') {
      return undefined;
    }

    const trimmed = sourceKey.trim();

    return trimmed.length === 0 ? undefined : trimmed;
  }

  /** Fixture workflows are development and CI scaffolding and never ship to production. */
  private getActiveScopes(): readonly WorkflowScope[] {
    if (this.configService.get<string>('NODE_ENV') === PRODUCTION_NODE_ENV) {
      return WORKFLOW_SCOPES.filter((scope) => scope !== 'fixtures');
    }

    return WORKFLOW_SCOPES;
  }
}
