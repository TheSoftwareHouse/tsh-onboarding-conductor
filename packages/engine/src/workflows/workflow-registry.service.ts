import { Injectable } from '@nestjs/common';
import baseWorkflowConfig from './base-workflow.config.json';

@Injectable()
export class WorkflowRegistryService {
  private readonly workflows = new Map([[baseWorkflowConfig.id, baseWorkflowConfig]]);

  findById(flowId: string) {
    return this.workflows.get(flowId);
  }
}
