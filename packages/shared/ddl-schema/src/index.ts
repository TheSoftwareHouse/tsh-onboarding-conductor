export const ddlSchemaPackageName = '@tsh/ddl-schema';

export * from './workflow-contract';
export {
  WORKFLOW_INVALID,
  WorkflowInvalidError,
  validateAndNormalizeWorkflow,
} from './workflow-validator';
export { createStepDataValidator, type StepDataValidator } from './workflow-step-validator';
export { evaluateCondition, collectConditionReferences } from './workflow-condition';
export type {
  NormalizedWorkflowCondition,
  RawWorkflowCondition,
  WorkflowConditionContext,
  WorkflowConditionScalar,
} from './workflow-condition';
