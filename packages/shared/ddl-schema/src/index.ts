export const ddlSchemaPackageName = '@tsh/ddl-schema';

export * from './workflow-contract';
export {
  WORKFLOW_INVALID,
  WorkflowInvalidError,
  validateAndNormalizeWorkflow,
} from './workflow-validator';
export type { WorkflowInvalidPath, WorkflowInvalidReason } from './workflow-invalid.error';
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

// The mounting seam: register during startup, before the first workflow is validated.
export { listFieldTypes, registerFieldType } from './fields/field-type.registry';
export { listFieldFormats, registerFieldFormat } from './formats/field-format.registry';
export { getCompiledWorkflowJsonSchema } from './schema/compiled-workflow-json-schema';
export type {
  AnyNormalizedField,
  FieldNormalizationContext,
  JsonSchemaFragment,
  WorkflowFieldLevel,
  WorkflowFieldTypeDefinition,
} from './fields/field-type.port';
export type { WorkflowFieldFormatDefinition } from './formats/field-format.port';

// Step types: the only authored form of a workflow, compiled to the runtime step shape before
// anything validates it.
export {
  compileWorkflow,
  compileWorkflowReport,
  type WorkflowCompilationReport,
  type StepPortReport,
  type StepReport,
} from './step-types/workflow.compiler';
// The migration path for a document written as untyped steps, before step types existed.
export {
  OTP_CHANNELS,
  OTP_CONFIG_KEYS,
  OTP_OPERATIONS,
  type OtpChannelName,
  type OtpOperation,
} from './step-types/types/otp-verify.step-type';
export { convertUntypedSteps } from './step-types/untyped-steps.converter';
export { getWorkflowJsonSchema } from './schema/workflow-json-schema';
// The mounting seam, matching the field-type one: register during startup.
export {
  BUILT_IN_STEP_TYPES,
  findStepType,
  listStepTypes,
  listStepTypeNames,
  registerStepType,
  type BuiltInWorkflowStepType,
  type WorkflowStepTypeName,
} from './step-types/step-type.registry';
export type {
  DerivedConnectorDeclaration,
  StepConnectorBinding,
  StepConnectorFallbackBinding,
  StepConnectorSlot,
} from './step-types/step-config.utils';
export {
  CANONICAL_FIELD_ROLES,
  DOCUMENT_SET_TYPES,
  DOCUMENT_SIDES,
  STEP_CATEGORIES,
  type CanonicalFieldMap,
  type CanonicalFieldRole,
  type StepFieldDescriptor,
  type StepFieldMap,
  type StepPublication,
  type PublishedDocument,
  type PublishedDocumentOption,
  type PublishedQuestionnaireItem,
  type WorkflowStepCategory,
  type WorkflowStepCompilationContext,
  type WorkflowStepContract,
  type WorkflowStepPort,
  type WorkflowStepTypeDefinition,
} from './step-types/step-type.port';
export {
  COUNTRY_PRESETS,
  COUNTRY_PRESET_NAMES,
  EEA_ID_CARD_ISSUERS,
  EEA_MEMBER_STATES,
} from './step-types/presets/country.preset';
export {
  QUESTIONNAIRE_SECTIONS,
  QUESTIONNAIRE_SECTION_NAMES,
  type QuestionnaireItemPreset,
  type QuestionnaireSectionPreset,
} from './step-types/presets/questionnaire.preset';
