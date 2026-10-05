import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import {
  compileWorkflowReport,
  validateAndNormalizeWorkflow,
  type NormalizedWorkflowDefinition,
  type NormalizedWorkflowStep,
} from '@tsh/ddl-schema';
import {
  WORKFLOW_CONNECTOR_EXECUTION_PORT,
  type ConnectorAdapterSummary,
  type ConnectorExecutionPort,
} from '../connectors/ports/connector-execution.port';
import { toPaginatedMeta } from '../pagination';
import { Workflow } from './domain/workflow';
import type { ListAdminWorkflowsQueryDto } from './dto/list-admin-workflows.query.dto';
import type { ListAdminWorkflowVersionsResponseDto } from './dto/list-admin-workflow-versions.response.dto';
import type { ListAdminWorkflowsResponseDto } from './dto/list-admin-workflows.response.dto';
import type { WorkflowDefinitionResponseDto } from './dto/workflow-definition.response.dto';
import { WorkflowVersionEntity } from './entity/workflow-version.entity';
import { DuplicateWorkflowSourceKeyError } from './errors/duplicate-workflow-source-key.error';
import { WorkflowConnectorDeclarationInvalidError } from './errors/workflow-connector-declaration-invalid.error';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowRetiredException } from './errors/workflow-retired.exception';
import { WorkflowRevisionNotFoundError } from './errors/workflow-revision-not-found.error';
import { WorkflowFileLoaderService } from './workflow-file-loader.service';
import { WorkflowConnectorSelectionsRepository } from './workflow-connector-selections.repository';
import { WORKFLOW_SCOPES, type WorkflowScope } from './workflow-scope';
import { RETIRED_WORKFLOW_STATUS } from './workflow-status';
import { WorkflowsRepository } from './workflows.repository';

const PRODUCTION_NODE_ENV = 'production';

type SourceKeyDeclaration = { readonly workflowId: string; readonly sourceKey: string };

/**
 * What an onboarding start resolves to: the workflow to run, and the uuid of the
 * version row it now points at — the one value every in-flight path needs to
 * store so it can find its way back to this exact revision with `getByVersionId`.
 */
export type ResolvedWorkflow = { readonly workflow: Workflow; readonly versionId: string };

@Injectable()
export class WorkflowRegistryService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowRegistryService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly workflowFileLoaderService: WorkflowFileLoaderService,
    private readonly workflowsRepository: WorkflowsRepository,
    private readonly connectorSelectionsRepository: WorkflowConnectorSelectionsRepository,
    /**
     * The only way in to the adapters: `ConnectorsModule` and this module `forwardRef` each other,
     * so the adapter collection and scope tokens are not injected here, and `listAdapters()` on
     * this port is how the registry learns what is registered.
     */
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
    const files = this.workflowFileLoaderService.load(scopes);

    // Validated before the publish, not after: an invalid file must fail the boot
    // without ever reaching the table, so fixing or removing it is enough to
    // recover. Once persisted, `findAll` below re-validates it anyway. The publish
    // itself refuses a file that disagrees with the revision already stored under
    // its id and version — a stored version is immutable — or that claims a family
    // the store holds under another scope, and either failure ends the boot too.
    for (const file of files) {
      this.normalizeDefinition(file.definition);
    }

    await this.workflowsRepository.publishFromFiles(manager, files);

    const storedWorkflows = await this.workflowsRepository.findAll(manager, scopes);
    const sourceKeyDeclarations: SourceKeyDeclaration[] = [];

    for (const storedWorkflow of storedWorkflows) {
      const definition = this.normalizeDefinition(storedWorkflow.definition);

      new Workflow(definition, this.connectorExecutionPort);

      sourceKeyDeclarations.push(
        ...this.collectSourceKeys(storedWorkflow.workflow.key, definition),
      );
    }

    this.assertUniqueSourceKeys(sourceKeyDeclarations);
    await this.warnAboutStaleSelections(manager);

    if ((await this.workflowsRepository.countPublished(manager, scopes)) === 0) {
      this.logger.warn(
        `No published workflows are available for scopes [${scopes.join(', ')}]; every onboarding start will fail with WORKFLOW_NOT_FOUND`,
      );
    }
  }

  /**
   * Resolves the revision an onboarding start runs — identical resolution to `getById` — and
   * hands back the version row's own uuid alongside it, which the caller is about to store on the
   * onboarding it creates so every later, in-flight lookup can reach this exact revision through
   * `getByVersionId` instead of a key and a possibly-stale version number.
   *
   * Pass `manager` to read inside a caller's transaction; without it the read uses the default
   * connection.
   */
  async resolveForStart(
    key: string,
    version?: number,
    manager?: EntityManager,
  ): Promise<ResolvedWorkflow> {
    const storedVersion = await this.resolveStoredVersion(key, version, manager, false);

    return {
      workflow: await this.toWorkflow(storedVersion, manager),
      versionId: storedVersion.workflowVersionId,
    };
  }

  /**
   * The revision an in-flight onboarding already stores the uuid of. `retired` is refused here
   * exactly like a pinned lookup by key and version is: an onboarding stops advancing the moment
   * its revision is discontinued, rather than only future starts being blocked.
   *
   * Pass `manager` to read inside a caller's transaction; without it the read uses the default
   * connection.
   */
  async getByVersionId(versionId: string, manager?: EntityManager): Promise<Workflow> {
    const readManager = manager ?? this.dataSource.manager;
    const storedVersion = await this.workflowsRepository.findVersionById(
      readManager,
      this.getActiveScopes(),
      versionId,
    );

    if (!storedVersion) {
      throw new WorkflowNotFoundException();
    }

    if (storedVersion.status === RETIRED_WORKFLOW_STATUS) {
      throw new WorkflowRetiredException();
    }

    return this.toWorkflow(storedVersion, readManager);
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
  async getById(key: string, version?: number, manager?: EntityManager): Promise<Workflow> {
    return this.toWorkflow(await this.resolveStoredVersion(key, version, manager, false), manager);
  }

  /** The admin read of a definition: the same resolution as `getById`, except a pinned `retired` revision is served. */
  async describeForAdmin(key: string, version?: number): Promise<WorkflowDefinitionResponseDto> {
    const storedVersion = await this.resolveStoredVersion(key, version, undefined, true);
    const report = compileWorkflowReport(storedVersion.definition);

    const workflow = await this.toWorkflow(storedVersion);

    return workflow.describeDefinition(report.steps, this.listSelectableAdapters());
  }

  /** Every stored version of a family in the active scopes, newest first. */
  async listVersionsForAdmin(key: string): Promise<ListAdminWorkflowVersionsResponseDto> {
    const versions = await this.workflowsRepository.listVersions(
      this.dataSource.manager,
      this.getActiveScopes(),
      key,
    );

    if (versions.length === 0) {
      throw new WorkflowNotFoundException();
    }

    return {
      items: versions.map(({ version, status, createdAt, updatedAt }) => ({
        version,
        status,
        createdAt,
        updatedAt,
      })),
    };
  }

  /** One page of the workflow catalogue for the admin list, scoped to the active scopes only. */
  async listForAdmin(query: ListAdminWorkflowsQueryDto): Promise<ListAdminWorkflowsResponseDto> {
    const result = await this.workflowsRepository.listForAdmin(
      this.dataSource.manager,
      this.getActiveScopes(),
      query,
    );

    return { items: result.items, meta: toPaginatedMeta(result) };
  }

  /**
   * The lookup shared by `resolveForStart`, `getById` and `describeForAdmin`: same pinned/unpinned
   * resolution. Only the admin read passes `allowRetired`; run-time resolution keeps refusing it.
   */
  private async resolveStoredVersion(
    key: string,
    version: number | undefined,
    manager: EntityManager | undefined,
    allowRetired: boolean,
  ): Promise<WorkflowVersionEntity> {
    const scopes = this.getActiveScopes();
    const readManager = manager ?? this.dataSource.manager;

    if (version === undefined) {
      const latestPublished = await this.workflowsRepository.findLatestPublished(
        readManager,
        scopes,
        key,
      );

      if (!latestPublished) {
        throw new WorkflowNotFoundException();
      }

      return latestPublished;
    }

    const storedVersion = await this.workflowsRepository.findRevision(
      readManager,
      scopes,
      key,
      version,
    );

    if (!storedVersion) {
      throw await this.pinnedLookupFailure(readManager, scopes, key, version);
    }

    if (!allowRetired && storedVersion.status === RETIRED_WORKFLOW_STATUS) {
      throw new WorkflowRetiredException();
    }

    return storedVersion;
  }

  /**
   * An unknown key and a known key pinned to an unknown version are different
   * mistakes and report differently, so the miss is attributed before it throws.
   */
  private async pinnedLookupFailure(
    manager: EntityManager,
    scopes: readonly WorkflowScope[],
    key: string,
    version: number,
  ): Promise<Error> {
    const revisionCount = await this.workflowsRepository.countRevisions(manager, scopes, key);

    return revisionCount > 0
      ? new WorkflowRevisionNotFoundError(key, version)
      : new WorkflowNotFoundException();
  }

  /**
   * The family's label rides along so the read-side projection can report it, and so do the
   * family's connector selections: read per resolution, never cached, so a selection takes effect
   * on the next request on every instance — the way connector settings do.
   */
  private async toWorkflow(
    storedVersion: WorkflowVersionEntity,
    manager?: EntityManager,
  ): Promise<Workflow> {
    const selections = await this.connectorSelectionsRepository.findByWorkflowId(
      manager ?? this.dataSource.manager,
      storedVersion.workflowId,
    );

    return new Workflow(
      this.normalizeDefinition(storedVersion.definition),
      this.connectorExecutionPort,
      storedVersion.workflow.name,
      selections,
    );
  }

  /**
   * The registered adapters an operator may choose among in this environment: every adapter the
   * port lists, minus those whose scope is inactive — `fixtures` in production, like the fixture
   * workflows.
   */
  listSelectableAdapters(): readonly ConnectorAdapterSummary[] {
    const scopes: readonly string[] = this.getActiveScopes();

    return (this.connectorExecutionPort?.listAdapters?.() ?? []).filter((adapter) =>
      scopes.includes(adapter.scope),
    );
  }

  /**
   * A selection naming an adapter this build does not ship (or hides in this environment) is not
   * silently dropped at execution — it fails loudly there — so the boot says which rows are stale.
   */
  private async warnAboutStaleSelections(manager: EntityManager): Promise<void> {
    const selectableIds = new Set(this.listSelectableAdapters().map((adapter) => adapter.id));

    for (const selection of await this.connectorSelectionsRepository.findAll(manager)) {
      if (!selectableIds.has(selection.connectorId)) {
        this.logger.warn(
          `Connector selection for workflow=${selection.workflow.key} step=${selection.stepName} names connector id=${selection.connectorId}, which is not registered; executing that step will fail until the selection is cleared`,
        );
      }
    }
  }

  /**
   * Everything startup checks a definition for, on demand and without storing it: the DDL, every
   * adapter's own declaration rules, and source-key uniqueness against every stored workflow. What
   * a builder asks before saving, so the answer it gets is the one the engine would give at boot.
   */
  async validateDefinition(
    definition: Readonly<Record<string, unknown>>,
  ): Promise<NormalizedWorkflowDefinition> {
    const normalized = this.normalizeDefinition(definition);
    const storedWorkflows = await this.workflowsRepository.findAll(
      this.dataSource.manager,
      this.getActiveScopes(),
    );
    const sourceKeyDeclarations = storedWorkflows.flatMap((storedWorkflow) =>
      this.collectSourceKeys(
        storedWorkflow.workflow.key,
        this.normalizeDefinition(storedWorkflow.definition),
      ),
    );

    sourceKeyDeclarations.push(...this.collectSourceKeys(normalized.id, normalized));
    this.assertUniqueSourceKeys(sourceKeyDeclarations);

    return normalized;
  }

  /**
   * Shared by both a file-sourced definition validated before it is persisted and
   * a stored row validated when it is read back, so every definition — whichever
   * source it came from — is held to the same schema and connector-declaration
   * rules. An adapter's refusal is re-thrown typed, with its message intact, so a
   * caller can tell an authoring defect from a failure of the engine's own.
   *
   * It also holds an asynchronous connector to its adapter's `callbackFields`: a step must declare
   * every field a callback may emit, or the verdict carrying one would be refused when it arrived.
   */
  normalizeDefinition(definition: Readonly<Record<string, unknown>>): NormalizedWorkflowDefinition {
    const normalized = validateAndNormalizeWorkflow(definition);
    const adaptersById = new Map(
      (this.connectorExecutionPort?.listAdapters?.() ?? []).map((adapter) => [adapter.id, adapter]),
    );

    for (const step of normalized.steps) {
      try {
        this.connectorExecutionPort?.validateDeclarations?.(step.connectors);
        this.assertCallbackFieldsDeclared(step, adaptersById);
      } catch (cause) {
        throw new WorkflowConnectorDeclarationInvalidError(
          step.name,
          cause instanceof Error ? cause : new Error(String(cause)),
        );
      }
    }

    return normalized;
  }

  private assertCallbackFieldsDeclared(
    step: NormalizedWorkflowStep,
    adaptersById: ReadonlyMap<string, ConnectorAdapterSummary>,
  ): void {
    for (const connector of step.connectors) {
      for (const candidate of [connector, ...connector.fallbacks]) {
        if (!candidate.async) {
          continue;
        }

        for (const field of adaptersById.get(candidate.id)?.callbackFields ?? []) {
          if (!Object.prototype.hasOwnProperty.call(step.data, field)) {
            throw new Error(
              `connector ${candidate.id} emits callback field "${field}" that step "${step.name}" does not declare`,
            );
          }
        }
      }
    }
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
        // Every fallback is a candidate provider for the same slot, so its own `config.sourceKey`
        // must join the sweep — otherwise the uniqueness rule could be bypassed by moving a
        // colliding key from a primary into any link of its `fallback` chain.
        for (const declaration of [connector, ...connector.fallbacks]) {
          const sourceKey = this.readSourceKey(declaration.config);
          if (sourceKey !== undefined) {
            declarations.push({ workflowId, sourceKey });
          }
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
  getActiveScopes(): readonly WorkflowScope[] {
    if (this.configService.get<string>('NODE_ENV') === PRODUCTION_NODE_ENV) {
      return WORKFLOW_SCOPES.filter((scope) => scope !== 'fixtures');
    }

    return WORKFLOW_SCOPES;
  }
}
