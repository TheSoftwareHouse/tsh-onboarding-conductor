import Ajv, { AnySchema, type ValidateFunction } from 'ajv';
import {
  normalizeCondition,
  validateFieldDependencies,
  type ConditionNormalizationContext,
} from './conditions/condition.normalizer';
import type { NormalizedWorkflowCondition } from './workflow-condition';
import {
  normalizeConnectors,
  type ConnectorMappingContext,
} from './connectors/connector.normalizer';
import { normalizeWorkflowField } from './fields/field.normalizer';
import { getWorkflowJsonSchema } from './schema/workflow-json-schema';
import {
  collectFieldDeclarations,
  collectFieldNames,
  isTerminalStatus,
  validateStepCollection,
} from './steps/step.validator';
import { validateSkipGraph } from './scoring/skip-graph';
import { buildGuaranteedPredecessorsByStepName } from './transitions/step-graph';
import { normalizeTransition, validateTransitionGroups } from './transitions/transition.normalizer';
import { normalizeRootWebhook } from './webhooks/webhook.normalizer';
import {
  DEFAULT_STEP_WEIGHT,
  WORKFLOW_SCORING_BOUNDS,
  type NormalizedWorkflowDefinition,
  type NormalizedWorkflowField,
  type NormalizedWorkflowStep,
  type NormalizedWorkflowStepScoring,
  type RawWorkflowDefinition,
  type RawWorkflowStepScoring,
  type WorkflowStatus,
} from './workflow-contract';
import { failWorkflow } from './workflow-invalid.error';

export {
  WORKFLOW_INVALID,
  WorkflowInvalidError,
  type WorkflowInvalidReason,
} from './workflow-invalid.error';

type CompiledSchemaValidator = {
  schema: Record<string, unknown>;
  validate: ValidateFunction<RawWorkflowDefinition>;
};

let compiledSchemaValidator: CompiledSchemaValidator | undefined;

/**
 * Compiled on first use against the in-memory contract, and recompiled whenever that contract
 * changes — which is what lets a field type mounted during startup take effect.
 */
const getSchemaValidator = (): ValidateFunction<RawWorkflowDefinition> => {
  const schema = getWorkflowJsonSchema();

  if (compiledSchemaValidator?.schema !== schema) {
    compiledSchemaValidator = {
      schema,
      validate: new Ajv({ strict: true, allowUnionTypes: true }).compile<RawWorkflowDefinition>(
        schema as AnySchema,
      ),
    };
  }

  return compiledSchemaValidator.validate;
};

/** Maps the first Ajv error onto the invalid reason clients see. */
const validateSchema = (input: unknown): RawWorkflowDefinition => {
  const validateAgainstSchema = getSchemaValidator();

  if (validateAgainstSchema(input)) {
    return input as RawWorkflowDefinition;
  }

  const firstError = validateAgainstSchema.errors?.[0];
  if (firstError?.keyword === 'additionalProperties') {
    failWorkflow('UNKNOWN_PROPERTY');
  }
  if (firstError?.keyword === 'required' || firstError?.keyword === 'type') {
    failWorkflow('INVALID_SHAPE');
  }
  if (firstError?.keyword === 'minItems') {
    const instancePath = firstError.instancePath ?? '';
    const schemaPath = firstError.schemaPath ?? '';
    const isConditionBranch =
      instancePath.includes('/all') ||
      instancePath.includes('/any') ||
      instancePath.includes('/in') ||
      schemaPath.includes('/definitions/conditionAll') ||
      schemaPath.includes('/definitions/conditionAny') ||
      schemaPath.includes('/definitions/conditionFieldComparison');

    if (isConditionBranch) {
      failWorkflow('INVALID_SHAPE');
    }
  }

  return failWorkflow('INVALID_VALUE');
};

/**
 * The multiplier every arm of a step is scaled by. Defaulted here so the normalized shape is the
 * post-defaults one: a step declaring no `scoring` still reports a weight, and no consumer has to
 * remember that absence means one. The bounds repeat the JSON Schema's because this normalizer is
 * exported and reachable without going through Ajv first.
 */
const normalizeStepScoring = (
  scoring: RawWorkflowStepScoring | undefined,
): NormalizedWorkflowStepScoring => {
  if (scoring === undefined) {
    return { weight: DEFAULT_STEP_WEIGHT };
  }

  if (
    !Number.isInteger(scoring.weight) ||
    scoring.weight < WORKFLOW_SCORING_BOUNDS.minWeight ||
    scoring.weight > WORKFLOW_SCORING_BOUNDS.maxWeight
  ) {
    failWorkflow('INVALID_VALUE');
  }

  return { weight: scoring.weight };
};

export const validateAndNormalizeWorkflow = (input: unknown): NormalizedWorkflowDefinition => {
  const definition = validateSchema(input);
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
      scoring: normalizeStepScoring(rawStep.scoring),
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
    step.transitions = rawStep.transitions.map((transition) =>
      normalizeTransition(transition, { ...conditionContext, currentFieldName: undefined }),
    );

    // A `skip` condition is resolved by the engine, not the client, so it normalizes with the same
    // transition-level context — no `currentFieldName`, which is what admits `$score`.
    if (rawStep.skip !== undefined) {
      step.skip = {
        when: normalizeCondition(rawStep.skip.when, {
          ...conditionContext,
          currentFieldName: undefined,
        }) as NormalizedWorkflowCondition,
        target: rawStep.skip.target,
      };
    }
  }

  validateTransitionGroups(steps, stepsByName);
  validateFieldDependencies(fieldDefinitionsByName);
  validateSkipGraph(steps, stepsByName);

  return {
    id: definition.id,
    version: definition.version,
    name: definition.name,
    initial,
    webhook:
      definition.webhook === undefined ? undefined : normalizeRootWebhook(definition.webhook),
    steps,
    stepsByName,
  };
};
