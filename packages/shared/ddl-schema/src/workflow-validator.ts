import Ajv, { AnySchema } from 'ajv';
import workflowSchema from '../onboarding-workflow.schema.json';
import {
  NormalizedWorkflowDefinition,
  NormalizedWorkflowField,
  NormalizedWorkflowStep,
  RawWorkflowDefinition,
  RawWorkflowStep,
  WorkflowStatus,
} from './workflow-contract';

export const WORKFLOW_INVALID = 'WORKFLOW_INVALID' as const;

export type WorkflowInvalidReason =
  | 'INVALID_SHAPE'
  | 'UNKNOWN_PROPERTY'
  | 'INVALID_VALUE'
  | 'DUPLICATE_STEP_NAME'
  | 'DUPLICATE_FIELD_NAME'
  | 'DUPLICATE_TRANSITION'
  | 'INVALID_TRANSITIONS'
  | 'UNKNOWN_TARGET'
  | 'INVALID_TERMINAL_STEP';

export class WorkflowInvalidError extends Error {
  readonly code = WORKFLOW_INVALID;

  constructor(readonly reason: WorkflowInvalidReason) {
    super(WORKFLOW_INVALID);
    this.name = 'WorkflowInvalidError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const validator = new Ajv({ strict: true }).compile<RawWorkflowDefinition>(
  workflowSchema as AnySchema,
);

const fail = (reason: WorkflowInvalidReason): never => {
  throw new WorkflowInvalidError(reason);
};

const validateSchema = (input: unknown): RawWorkflowDefinition => {
  if (!validator(input)) {
    const firstError = validator.errors?.[0];
    if (firstError?.keyword === 'additionalProperties') {
      fail('UNKNOWN_PROPERTY');
    }
    if (firstError?.keyword === 'required' || firstError?.keyword === 'type') {
      fail('INVALID_SHAPE');
    }
    fail('INVALID_VALUE');
  }

  return input as RawWorkflowDefinition;
};

const validateStepCollection = (steps: RawWorkflowStep[], initialName: string): void => {
  const stepNames = new Set<string>();
  const fieldNames = new Set<string>();

  for (const step of steps) {
    if (stepNames.has(step.name)) {
      fail('DUPLICATE_STEP_NAME');
    }
    stepNames.add(step.name);

    for (const fieldName of Object.keys(step.data)) {
      if (fieldNames.has(fieldName)) {
        fail('DUPLICATE_FIELD_NAME');
      }
      fieldNames.add(fieldName);
    }
  }

  const initialStep = steps.find((step) => step.name === initialName);
  if (!initialStep) {
    fail('INVALID_VALUE');
  }
  const resolvedInitialStep = initialStep as RawWorkflowStep;

  for (const step of steps) {
    if (step.status === 'approved') {
      if (Object.keys(step.data).length > 0 || step.transitions.length !== 0) {
        fail('INVALID_TERMINAL_STEP');
      }
      continue;
    }

    const transitionStatuses = new Set<string>();
    for (const transition of step.transitions) {
      if (transitionStatuses.has(transition.status)) {
        fail('DUPLICATE_TRANSITION');
      }
      transitionStatuses.add(transition.status);
      if (!stepNames.has(transition.target)) {
        fail('UNKNOWN_TARGET');
      }
    }

    if (step.transitions.length !== 1) {
      fail('INVALID_TRANSITIONS');
    }
  }

  if (resolvedInitialStep.status === 'approved') {
    fail('INVALID_TERMINAL_STEP');
  }
};

export const validateAndNormalizeWorkflow = (input: unknown): NormalizedWorkflowDefinition => {
  const definition = validateSchema(input);
  const stepNames = new Set(definition.steps.map((step) => step.name));
  const initial = definition.initial ?? definition.steps[0]?.name;

  if (!initial || !stepNames.has(initial)) {
    fail('INVALID_VALUE');
  }

  validateStepCollection(definition.steps, initial);

  const steps: NormalizedWorkflowStep[] = definition.steps.map((step) => ({
    name: step.name,
    status: step.status as WorkflowStatus,
    data: Object.fromEntries(
      Object.entries(step.data).map(([fieldName, field]) => [
        fieldName,
        field as NormalizedWorkflowField,
      ]),
    ),
    transitions: step.transitions,
    terminal: step.status === 'approved',
  }));

  const stepsByName: Record<string, NormalizedWorkflowStep> = {};
  for (const step of steps) {
    stepsByName[step.name] = step;
  }

  return {
    id: definition.id,
    version: definition.version,
    name: definition.name,
    initial,
    steps,
    stepsByName,
  };
};
