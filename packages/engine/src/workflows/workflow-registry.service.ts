import { Injectable, Optional } from '@nestjs/common';
import { validateAndNormalizeWorkflow, WorkflowInvalidError } from '@tsh/ddl-schema';
import baseWorkflowConfig from './config/base-workflow.config.json';
import { Workflow } from './domain/workflow';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';

@Injectable()
export class WorkflowRegistryService {
  private readonly workflows: ReadonlyMap<string, Workflow>;

  constructor(@Optional() workflowConfig: unknown = baseWorkflowConfig) {
    const workflowDefinition = validateAndNormalizeWorkflow(workflowConfig);
    const workflow = new Workflow(workflowDefinition);
    this.workflows = new Map([[workflow.id, workflow]]);
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
