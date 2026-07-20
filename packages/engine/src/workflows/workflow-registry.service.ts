import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateAndNormalizeWorkflow, WorkflowInvalidError } from '@tsh/ddl-schema';
import { Workflow } from './domain/workflow';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';

@Injectable()
export class WorkflowRegistryService {
  private readonly workflows: ReadonlyMap<string, Workflow>;

  constructor(private readonly configService: ConfigService) {
    const workflowsDir = this.configService.getOrThrow<string>('WORKFLOWS_DIR');

    let directoryEntries: string[];
    try {
      directoryEntries = readdirSync(workflowsDir, { encoding: 'utf8' });
    } catch (error) {
      const errorMessage = error instanceof Error ? `: ${error.message}` : '';
      throw new Error(`Cannot read workflows directory: ${workflowsDir}${errorMessage}`);
    }

    const jsonFiles = directoryEntries.filter((entryName) => {
      if (!entryName.endsWith('.json')) {
        return false;
      }

      const entryPath = join(workflowsDir, entryName);
      return statSync(entryPath).isFile();
    });

    if (jsonFiles.length === 0) {
      throw new Error(`Workflows directory is empty or has no direct JSON files: ${workflowsDir}`);
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
      const workflow = new Workflow(workflowDefinition);

      if (loadedWorkflows.has(workflow.id)) {
        throw new WorkflowInvalidError('INVALID_VALUE');
      }

      loadedWorkflows.set(workflow.id, workflow);
    }

    this.workflows = loadedWorkflows;
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
