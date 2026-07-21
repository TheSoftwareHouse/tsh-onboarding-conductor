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
import { WorkflowsDirectoryEmptyError } from './errors/workflows-directory-empty.error';
import { WorkflowsDirectoryReadError } from './errors/workflows-directory-read.error';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';

@Injectable()
export class WorkflowRegistryService {
  private readonly workflows: ReadonlyMap<string, Workflow>;

  constructor(
    private readonly configService: ConfigService,
    @Inject(WORKFLOW_CONNECTOR_EXECUTION_PORT)
    @Optional()
    private readonly connectorExecutionPort?: ConnectorExecutionPort,
  ) {
    const workflowsDir = this.configService.getOrThrow<string>('WORKFLOWS_DIR');
    this.workflows = this.loadWorkflowsFromDirectory(workflowsDir);
  }

  private loadWorkflowsFromDirectory(workflowsDir: string): ReadonlyMap<string, Workflow> {
    let directoryEntries: string[];
    try {
      directoryEntries = readdirSync(workflowsDir, { encoding: 'utf8' });
    } catch (error) {
      throw new WorkflowsDirectoryReadError(
        workflowsDir,
        error instanceof Error ? error : undefined,
      );
    }

    const jsonFiles = directoryEntries.filter((entryName) => {
      if (!entryName.endsWith('.json')) {
        return false;
      }

      const entryPath = join(workflowsDir, entryName);
      return statSync(entryPath).isFile();
    });

    if (jsonFiles.length === 0) {
      throw new WorkflowsDirectoryEmptyError(workflowsDir);
    }

    const loadedWorkflows = new Map<string, Workflow>();

    for (const fileName of jsonFiles) {
      const filePath = join(workflowsDir, fileName);
      let workflowConfig: unknown;

      try {
        workflowConfig = JSON.parse(readFileSync(filePath, 'utf8'));
      } catch {
        throw new WorkflowInvalidError('INVALID_VALUE');
      }

      const workflowDefinition = validateAndNormalizeWorkflow(workflowConfig);
      const workflow = new Workflow(workflowDefinition, this.connectorExecutionPort);

      if (loadedWorkflows.has(workflow.id)) {
        throw new WorkflowInvalidError('INVALID_VALUE');
      }

      loadedWorkflows.set(workflow.id, workflow);
    }

    return loadedWorkflows;
  }
  getById(workflowId: string, version?: number): Workflow {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new WorkflowNotFoundException();
    }

    if (version !== undefined && version !== workflow.version) {
      throw new WorkflowInvalidError('INVALID_VALUE');
    }

    return workflow;
  }
}
