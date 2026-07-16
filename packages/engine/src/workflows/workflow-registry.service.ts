import { Injectable, Optional } from '@nestjs/common';
import { validateAndNormalizeWorkflow, WorkflowInvalidError } from '@tsh/ddl-schema';
import baseWorkflowConfig from './base-workflow.config.json';
import { WorkflowDefinition } from './workflow.types';

@Injectable()
export class WorkflowRegistryService {
  private readonly workflows: ReadonlyMap<string, WorkflowDefinition>;

  constructor(@Optional() workflowConfig: unknown = baseWorkflowConfig) {
    const workflow = validateAndNormalizeWorkflow(workflowConfig);
    this.workflows = new Map([[workflow.id, workflow]]);
  }

  findById(workflowId: string, version?: number): WorkflowDefinition | undefined {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return undefined;
    }

    if (version !== undefined && version !== workflow.version) {
      throw new WorkflowInvalidError('INVALID_VALUE');
    }

    return workflow;
  }
}
