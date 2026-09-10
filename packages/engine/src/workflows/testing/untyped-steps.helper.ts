import {
  convertUntypedSteps,
  validateAndNormalizeWorkflow,
  type CompiledWorkflowDefinition,
  type NormalizedWorkflowDefinition,
} from '@tsh/ddl-schema';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A `steps` list in the compiled shape: at least one entry names no `type`, as no typed step can. */
const hasUntypedSteps = (input: unknown): input is CompiledWorkflowDefinition =>
  isPlainObject(input) &&
  Array.isArray(input.steps) &&
  !input.steps.every((step) => isPlainObject(step) && typeof step.type === 'string');

/**
 * Normalizes a document a spec wrote as untyped steps — the compiled shape the engine's own rules
 * are stated in — by loading it as the `custom` steps every such document converts to, which is the
 * only form the DDL accepts. A document already written as typed steps passes through unchanged.
 */
export const normalizeUntypedSteps = (input: unknown): NormalizedWorkflowDefinition =>
  validateAndNormalizeWorkflow(hasUntypedSteps(input) ? convertUntypedSteps(input) : input);
