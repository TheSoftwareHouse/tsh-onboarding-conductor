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
export { getWorkflowJsonSchema } from './schema/workflow-json-schema';
export type {
  AnyNormalizedField,
  FieldNormalizationContext,
  JsonSchemaFragment,
  WorkflowFieldLevel,
  WorkflowFieldTypeDefinition,
} from './fields/field-type.port';
export type { WorkflowFieldFormatDefinition } from './formats/field-format.port';

// The node layer: the authored form of a workflow, compiled to steps before anything validates it.
export {
  compileNodeGraph,
  compileNodeGraphReport,
  type NodeGraphReport,
  type NodePortReport,
  type NodeReport,
} from './nodes/node-graph.compiler';
export {
  isNodeGraphDefinition,
  type RawWorkflowNode,
  type RawWorkflowNodeEdge,
  type RawWorkflowNodeEdgeArm,
  type RawWorkflowNodeGraphDefinition,
  type RawWorkflowNodeInclude,
  type RawWorkflowNodeMeta,
} from './nodes/node-graph.contract';
export { getNodeGraphJsonSchema } from './nodes/node-graph.schema';
// The mounting seam, matching the field-type one: register during startup.
export {
  BUILT_IN_NODE_TYPES,
  findNodeType,
  listNodeTypes,
  listNodeTypeNames,
  registerNodeType,
  type BuiltInWorkflowNodeType,
  type WorkflowNodeTypeName,
} from './nodes/node-type.registry';
export {
  CANONICAL_FIELD_ROLES,
  DOCUMENT_SET_TYPES,
  DOCUMENT_SIDES,
  NODE_CATEGORIES,
  type CanonicalFieldMap,
  type CanonicalFieldRole,
  type NodeFieldDescriptor,
  type NodeFieldMap,
  type NodePublication,
  type PublishedDocument,
  type PublishedDocumentOption,
  type PublishedQuestionnaireItem,
  type WorkflowNodeCategory,
  type WorkflowNodeCompilationContext,
  type WorkflowNodeContract,
  type WorkflowNodePort,
  type WorkflowNodeTypeDefinition,
} from './nodes/node-type.port';
export {
  COUNTRY_PRESETS,
  COUNTRY_PRESET_NAMES,
  EEA_ID_CARD_ISSUERS,
  EEA_MEMBER_STATES,
} from './nodes/presets/country.preset';
export {
  QUESTIONNAIRE_SECTIONS,
  QUESTIONNAIRE_SECTION_NAMES,
  type QuestionnaireItemPreset,
  type QuestionnaireSectionPreset,
} from './nodes/presets/questionnaire.preset';
