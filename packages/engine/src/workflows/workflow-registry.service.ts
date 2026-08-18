import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateAndNormalizeWorkflow, WorkflowInvalidError } from '@tsh/ddl-schema';
import {
  WORKFLOW_CONNECTOR_EXECUTION_PORT,
  type ConnectorExecutionPort,
} from '../connectors/ports/connector-execution.port';
import { Workflow } from './domain/workflow';
import { DuplicateWorkflowIdError } from './errors/duplicate-workflow-id.error';
import { NoWorkflowsConfiguredError } from './errors/no-workflows-configured.error';
import { WorkflowsDirectoryEmptyError } from './errors/workflows-directory-empty.error';
import { WorkflowsDirectoryReadError } from './errors/workflows-directory-read.error';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import {
  resolveWorkflowSources,
  type WorkflowSource,
  type WorkflowSourceKind,
} from './workflow-source';

type RegisteredWorkflow = Readonly<{
  workflow: Workflow;
  source: WorkflowSourceKind;
}>;

@Injectable()
export class WorkflowRegistryService {
  private readonly registrations: ReadonlyMap<string, RegisteredWorkflow>;

  constructor(
    private readonly configService: ConfigService,
    @Inject(WORKFLOW_CONNECTOR_EXECUTION_PORT)
    @Optional()
    private readonly connectorExecutionPort?: ConnectorExecutionPort,
  ) {
    this.registrations = this.loadConfiguredSources();
  }

  private loadConfiguredSources(): ReadonlyMap<string, RegisteredWorkflow> {
    const loaded = new Map<string, RegisteredWorkflow>();

    for (const source of this.resolveSources()) {
      for (const workflow of this.loadWorkflowsFromDirectory(source)) {
        const existing = loaded.get(workflow.id);

        if (existing) {
          throw new DuplicateWorkflowIdError(workflow.id, existing.source, source.kind);
        }

        loaded.set(workflow.id, { workflow, source: source.kind });
      }
    }

    if (loaded.size === 0) {
      throw new NoWorkflowsConfiguredError();
    }

    return loaded;
  }

  private resolveSources(): readonly WorkflowSource[] {
    return resolveWorkflowSources({
      userDirectory: this.configService.get<string>('WORKFLOWS_DIR'),
      fixturesEnabled: this.configService.get<boolean>('FIXTURE_WORKFLOWS_ENABLED') === true,
    });
  }

  private loadWorkflowsFromDirectory(source: WorkflowSource): readonly Workflow[] {
    let directoryEntries: string[];
    try {
      directoryEntries = readdirSync(source.directory, { encoding: 'utf8' });
    } catch (error) {
      // An optional source may simply not exist — the built-in directory has a default path that
      // no one has to create. Any other read failure is still a hard startup error.
      if (source.optional && (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
        return [];
      }

      throw new WorkflowsDirectoryReadError(
        source.directory,
        error instanceof Error ? error : undefined,
      );
    }

    const jsonFiles = directoryEntries.filter((entryName) => {
      if (!entryName.endsWith('.json')) {
        return false;
      }

      const entryPath = join(source.directory, entryName);
      return statSync(entryPath).isFile();
    });

    if (jsonFiles.length === 0 && !source.optional) {
      throw new WorkflowsDirectoryEmptyError(source.directory);
    }

    const loadedWorkflows: Workflow[] = [];
    const idsInThisDirectory = new Set<string>();

    for (const fileName of jsonFiles) {
      const filePath = join(source.directory, fileName);
      let workflowConfig: unknown;

      try {
        workflowConfig = JSON.parse(readFileSync(filePath, 'utf8'));
      } catch {
        throw new WorkflowInvalidError('INVALID_VALUE');
      }

      const workflowDefinition = validateAndNormalizeWorkflow(workflowConfig);

      for (const step of workflowDefinition.steps) {
        this.connectorExecutionPort?.validateDeclarations?.(step.connectors);
      }

      const workflow = new Workflow(workflowDefinition, this.connectorExecutionPort, source.kind);

      // Two files in one directory claiming the same id keeps its long-standing stable error
      // code. DuplicateWorkflowIdError is reserved for collisions *between* sources, where
      // naming the two sources is what makes the failure actionable.
      if (idsInThisDirectory.has(workflow.id)) {
        throw new WorkflowInvalidError('INVALID_VALUE');
      }

      idsInThisDirectory.add(workflow.id);
      loadedWorkflows.push(workflow);
    }

    return loadedWorkflows;
  }

  getById(workflowId: string, version?: number): Workflow {
    const registration = this.registrations.get(workflowId);
    if (!registration) {
      throw new WorkflowNotFoundException();
    }

    const workflow = registration.workflow;

    if (version !== undefined && version !== workflow.version) {
      throw new WorkflowInvalidError('INVALID_VALUE');
    }

    return workflow;
  }

  /** Which source a workflow came from. Exposed for diagnostics and startup logging. */
  getSourceKind(workflowId: string): WorkflowSourceKind | undefined {
    return this.registrations.get(workflowId)?.source;
  }
}
