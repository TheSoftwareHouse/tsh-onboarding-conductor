import Ajv, { AnySchema } from 'ajv';
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
import { workflowJsonSchema } from './schema/workflow-json-schema';
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
  RawWorkflowDefinition,
  RawWorkflowStep,
  WorkflowStatus,
} from './workflow-contract';
import { failWorkflow } from './workflow-invalid.error';

export {
  WORKFLOW_INVALID,
  WorkflowInvalidError,
  type WorkflowInvalidReason,
} from './workflow-invalid.error';

const validateAgainstSchema = new Ajv({
  strict: true,
  allowUnionTypes: true,
}).compile<RawWorkflowDefinition>(workflowJsonSchema as AnySchema);

/** Maps the first Ajv error onto the invalid reason clients see. */
const validateSchema = (input: unknown): RawWorkflowDefinition => {
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

export const validateAndNormalizeWorkflow = (input: unknown): NormalizedWorkflowDefinition => {
  const definition = validateSchema(input);
  const workflowFieldNames = collectFieldNames(definition.steps);
  const fieldDeclarationsByName = collectFieldDeclarations(definition.steps);
  const rawStepsByName = Object.fromEntries(
    definition.steps.map((step) => [step.name, step]),
  ) as Record<string, RawWorkflowStep>;
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
      connectors: normalizeConnectors(
        rawStep,
        workflowFieldNames,
        rawStepsByName,
        connectorMappingContext,
      ),
      transitions: [],
      terminal: isTerminalStatus(rawStep.status),
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
  }

  validateTransitionGroups(steps, stepsByName);
  validateFieldDependencies(fieldDefinitionsByName);

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
