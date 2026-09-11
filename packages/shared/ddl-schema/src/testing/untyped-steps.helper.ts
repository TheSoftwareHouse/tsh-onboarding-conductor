import { convertUntypedSteps } from '../step-types/untyped-steps.converter';
import { isPlainObject } from '../value-guards';
import type {
  CompiledWorkflowDefinition,
  NormalizedWorkflowDefinition,
} from '../workflow-contract';
import { validateAndNormalizeWorkflow } from '../workflow-validator';

/** A `steps` list in the compiled shape: at least one entry names no `type`, as no typed step can. */
const hasUntypedSteps = (input: unknown): input is CompiledWorkflowDefinition =>
  isPlainObject(input) &&
  Array.isArray(input.steps) &&
  !input.steps.every((step) => isPlainObject(step) && typeof step.type === 'string');

/**
 * A document written as untyped steps, as it has to be loaded now: the `custom` steps it converts
 * to. The step-level rules — conditions, connectors, transitions, fields — are stated and tested in
 * the compiled form, which is also what every step type compiles to, so the specs keep writing that
 * shape and load it through the only entry point there is. Anything else — a typed document, or a
 * malformed one — passes through unchanged, so it is refused by the workflow schema like any other.
 */
export const toCustomStepDocument = (input: unknown): unknown =>
  hasUntypedSteps(input) ? convertUntypedSteps(input) : input;

export const validateAndNormalizeUntypedSteps = (input: unknown): NormalizedWorkflowDefinition =>
  validateAndNormalizeWorkflow(toCustomStepDocument(input));
