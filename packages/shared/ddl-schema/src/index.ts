export const ddlSchemaPackageName = '@tsh/ddl-schema';

export * from './workflow-contract';
export {
  WORKFLOW_INVALID,
  WorkflowInvalidError,
  validateAndNormalizeWorkflow,
} from './workflow-validator';
export type { WorkflowInvalidReason } from './workflow-invalid.error';
export { createStepDataValidator, type StepDataValidator } from './workflow-step-validator';
export { evaluateCondition, collectConditionReferences } from './workflow-condition';
export type {
  NormalizedWorkflowCondition,
  RawWorkflowCondition,
  WorkflowConditionContext,
  WorkflowConditionScalar,
} from './workflow-condition';
export { WORKFLOW_FIELD_TYPES } from './fields/field-type.registry';
export { WORKFLOW_FIELD_FORMATS } from './formats/field-format.registry';
export { isNormalizedFileField, type NormalizedFileField } from './fields/file.field-type';
export type { WorkflowFieldTypeDefinition, WorkflowFieldLevel } from './fields/field-type.port';
