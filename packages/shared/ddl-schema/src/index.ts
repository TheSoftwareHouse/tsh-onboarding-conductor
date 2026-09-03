export const ddlSchemaPackageName = '@tsh/ddl-schema';

export * from './workflow-contract';
export {
  WORKFLOW_INVALID,
  WorkflowInvalidError,
  validateAndNormalizeWorkflow,
} from './workflow-validator';
export type { WorkflowInvalidReason } from './workflow-invalid.error';
export {
  buildFieldDataSchema,
  createStepDataValidator,
  type StepDataValidator,
} from './workflow-step-validator';
export { evaluateCondition, collectConditionReferences } from './workflow-condition';
export type {
  NormalizedWorkflowCondition,
  RawWorkflowCondition,
  WorkflowConditionContext,
  WorkflowConditionScalar,
} from './workflow-condition';
export { isNormalizedFileField, type NormalizedFileField } from './fields/file.field-type';
export {
  CONDITION_VARIABLE_PREFIX,
  CONDITION_VARIABLE_TYPES,
  SCORE_CONDITION_VARIABLE,
  isConditionVariable,
} from './scoring/condition-variable';
export { validateSkipGraph } from './scoring/skip-graph';

// The mounting seam: register during startup, before the first workflow is validated.
export { listFieldTypes, registerFieldType } from './fields/field-type.registry';
export { listFieldFormats, registerFieldFormat } from './formats/field-format.registry';
export { getWorkflowJsonSchema } from './schema/workflow-json-schema';
export type {
  AnyNormalizedField,
  FieldNormalizationContext,
  JsonSchemaFragment,
  WorkflowFieldLevel,
  WorkflowFieldTypeDefinition,
} from './fields/field-type.port';
export type { WorkflowFieldFormatDefinition } from './formats/field-format.port';
