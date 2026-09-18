import Ajv, { AnySchema, type ValidateFunction } from 'ajv';
import { normalizeWorkflowAgreements } from './agreements/agreement.normalizer';
import {
  normalizeCondition,
  validateFieldDependencies,
  type ConditionNormalizationContext,
} from './conditions/condition.normalizer';
import {
  normalizeConnectors,
  type ConnectorMappingContext,
} from './connectors/connector.normalizer';
import { normalizeWorkflowField } from './fields/field.normalizer';
import {
  compileWorkflowReport,
  type WorkflowCompilationReport,
} from './step-types/workflow.compiler';
import { failSchemaValidation } from './schema/schema-failure';
import { getCompiledWorkflowJsonSchema } from './schema/compiled-workflow-json-schema';
import { normalizeScoreDeclarations, normalizeScoringRules } from './scoring/scoring.normalizer';
import {
  collectFieldDeclarations,
  collectFieldNames,
  isTerminalStatus,
  validateStepCollection,
} from './steps/step.validator';
import { buildGuaranteedPredecessorsByStepName } from './transitions/step-graph';
import { normalizeTransition, validateTransitionGroups } from './transitions/transition.normalizer';
import { normalizeRootWebhook } from './webhooks/webhook.normalizer';
import type {
  NormalizedWorkflowDefinition,
  NormalizedWorkflowField,
  NormalizedWorkflowStep,
  CompiledWorkflowDefinition,
  WorkflowStatus,
} from './workflow-contract';
import {
  failWorkflow,
  WorkflowInvalidError,
  type WorkflowInvalidPath,
} from './workflow-invalid.error';

export {
  WORKFLOW_INVALID,
  WorkflowInvalidError,
  type WorkflowInvalidReason,
} from './workflow-invalid.error';

type CompiledSchemaValidator = {
  schema: Record<string, unknown>;
  validate: ValidateFunction<CompiledWorkflowDefinition>;
};

let compiledSchemaValidator: CompiledSchemaValidator | undefined;

/**
 * Compiled on first use against the in-memory contract, and recompiled whenever that contract
 * changes — which is what lets a field type mounted during startup take effect.
 */
const getSchemaValidator = (): ValidateFunction<CompiledWorkflowDefinition> => {
  const schema = getCompiledWorkflowJsonSchema();

  if (compiledSchemaValidator?.schema !== schema) {
    compiledSchemaValidator = {
      schema,
      validate: new Ajv({
        strict: true,
        allowUnionTypes: true,
      }).compile<CompiledWorkflowDefinition>(schema as AnySchema),
    };
  }

  return compiledSchemaValidator.validate;
};

const validateSchema = (input: unknown): CompiledWorkflowDefinition => {
  const validateAgainstSchema = getSchemaValidator();

  if (validateAgainstSchema(input)) {
    return input as CompiledWorkflowDefinition;
  }

  return failSchemaValidation(validateAgainstSchema.errors?.[0]);
};

/**
 * Validates and normalizes the compiled form: the schema first, then the structural rules —
 * unique names, the terminal-step contract, the dominator rule for connector mappings, transition
 * groups, field dependencies — and the per-step normalization the engine runs on. This is the one
 * runtime contract; every step type compiles to it and nothing reaches the engine any other way.
 */
const normalizeStepDefinition = (
  compiled: CompiledWorkflowDefinition,
): NormalizedWorkflowDefinition => {
  const definition = validateSchema(compiled);
  const fieldDeclarationsByName = collectFieldDeclarations(definition.steps);
  const workflowFieldNames = collectFieldNames(fieldDeclarationsByName);
  const stepNames = new Set(definition.steps.map((step) => step.name));
  const initial = definition.initial ?? definition.steps[0]?.name;

  if (!initial || !stepNames.has(initial)) {
    failWorkflow('INVALID_VALUE');
  }

  validateStepCollection(definition.steps, initial);

  const connectorMappingContext: ConnectorMappingContext = {
    fieldDeclarationsByName,
    guaranteedPredecessorsByStepName: buildGuaranteedPredecessorsByStepName(
      definition.steps,
      initial,
    ),
  };

  const scores = normalizeScoreDeclarations(definition.scoring);
  const declaredScoreNames = new Set(Object.keys(scores));

  const fieldDefinitionsByName: Record<string, NormalizedWorkflowField> = {};
  const conditionContext: ConditionNormalizationContext = {
    rootFieldNames: workflowFieldNames,
    fieldDefinitionsByName,
  };

  const normalizedStepEntries = definition.steps.map((step) => ({
    rawStep: step,
    normalizedData: Object.fromEntries(
      Object.entries(step.data).map(([fieldName, field]) => {
        const normalizedField = normalizeWorkflowField(field, 'root') as NormalizedWorkflowField;
        fieldDefinitionsByName[fieldName] = normalizedField;
        return [fieldName, normalizedField];
      }),
    ),
  }));

  const steps: NormalizedWorkflowStep[] = normalizedStepEntries.map(
    ({ rawStep, normalizedData }) => ({
      name: rawStep.name,
      status: rawStep.status as WorkflowStatus,
      data: normalizedData,
      connectors: normalizeConnectors(rawStep, workflowFieldNames, connectorMappingContext),
      transitions: [],
      terminal: isTerminalStatus(rawStep.status),
      scoring: [],
    }),
  );

  const stepsByName: Record<string, NormalizedWorkflowStep> = {};
  for (const step of steps) {
    stepsByName[step.name] = step;
  }

  // Conditions are normalized in a second pass, once every root field is known.
  for (const { rawStep, normalizedData } of normalizedStepEntries) {
    const step = stepsByName[rawStep.name];
    if (!step) {
      failWorkflow('INVALID_VALUE');
    }

    for (const [fieldName, normalizedField] of Object.entries(normalizedData)) {
      const rawField = rawStep.data[fieldName];
      if (rawField === undefined || !Object.prototype.hasOwnProperty.call(rawField, 'when')) {
        continue;
      }

      normalizedField.when = normalizeCondition(rawField.when, {
        ...conditionContext,
        currentFieldName: fieldName,
      });
    }

    step.data = normalizedData;
    step.scoring = normalizeScoringRules(rawStep, conditionContext, declaredScoreNames);
    step.transitions = rawStep.transitions.map((transition) =>
      normalizeTransition(
        transition,
        { ...conditionContext, currentFieldName: undefined },
        declaredScoreNames,
      ),
    );
  }

  validateTransitionGroups(steps, stepsByName);
  validateFieldDependencies(fieldDefinitionsByName);

  // Last, because a root declaration names a step and one of its fields: both have to be normalized
  // before the binding can be checked against them.
  const agreements = normalizeWorkflowAgreements(definition, stepsByName);

  return {
    id: definition.id,
    version: definition.version,
    initial,
    webhook:
      definition.webhook === undefined ? undefined : normalizeRootWebhook(definition.webhook),
    steps,
    stepsByName,
    scores,
    agreements,
  };
};

const COMPILED_STEP_PATH_PATTERN = /^steps\[(\d+)\]/;

/**
 * Restates a path the compiled phase reported — `steps[k]…`, indexing the compiled steps of a
 * document nobody wrote — as the authored step whose type produced compiled step `k`. Only the step
 * is named, never a member: every member an author can write, a `custom` step's config included, is
 * validated against the compiled schema's own definitions before compilation, so a compiled step
 * the compiled schema refuses came out of a step type's `compile` and has no authored member to
 * point at. Root members keep their names, since both forms spell `initial`, `webhook` and
 * `scoring` alike.
 */
const toAuthoredPath = (
  report: WorkflowCompilationReport,
  path: WorkflowInvalidPath | undefined,
): WorkflowInvalidPath | undefined => {
  const compiledPath = path === undefined ? null : COMPILED_STEP_PATH_PATTERN.exec(path);

  if (compiledPath === null) {
    return path;
  }

  const compiledIndex = Number(compiledPath[1]);
  let firstCompiledIndex = 0;

  for (const [authoredIndex, step] of report.steps.entries()) {
    if (compiledIndex < firstCompiledIndex + step.compiledStepNames.length) {
      return `steps[${authoredIndex}]`;
    }

    firstCompiledIndex += step.compiledStepNames.length;
  }

  return path;
};

/**
 * Validates and normalizes a workflow document. Typed steps are the only authored form: the document
 * is compiled to the runtime step shape first, and that compiled document is then validated and
 * normalized exactly as the engine's runtime contract requires — so there is one runtime shape, one
 * set of structural rules, and no way for what an author writes and what the engine runs to
 * disagree. Everything downstream, the engine included, only ever sees compiled steps.
 *
 * A failure the compiled phase reports is restated in the author's coordinates: `steps[3].data.email`
 * indexes compiled steps nobody wrote, so it becomes the authored step the author can actually go
 * and fix.
 */
export const validateAndNormalizeWorkflow = (input: unknown): NormalizedWorkflowDefinition => {
  const report = compileWorkflowReport(input);

  try {
    return normalizeStepDefinition(report.definition);
  } catch (error) {
    if (error instanceof WorkflowInvalidError) {
      throw new WorkflowInvalidError(error.reason, toAuthoredPath(report, error.path));
    }

    throw error;
  }
};
