import workflowConfig from './differently-named-workflow.config.json';
import { validateAndNormalizeWorkflow } from '@tsh/ddl-schema';

const normalizedWorkflow = validateAndNormalizeWorkflow(workflowConfig);

export const testWorkflowRegistry = {
  findById(workflowId: string, version?: number) {
    if (workflowId !== normalizedWorkflow.id) {
      return undefined;
    }
    if (version !== undefined && version !== normalizedWorkflow.version) {
      return undefined;
    }
    return normalizedWorkflow;
  },
};
