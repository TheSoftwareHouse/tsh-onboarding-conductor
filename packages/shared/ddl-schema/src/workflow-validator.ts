import Ajv, { AnySchema } from 'ajv';
import workflowSchema from '../onboarding-workflow.schema.json';
import {
  BooleanValidation,
  DateValidation,
  NormalizedWorkflowConnectorDeclaration,
  NormalizedWorkflowDefinition,
  NormalizedWorkflowField,
  NormalizedWorkflowStep,
  NumberValidation,
  RawWorkflowDefinition,
  RawWorkflowStep,
  TextValidation,
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

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isInteger = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isInteger(value);
};

const isFullDateString = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

const validateSelectionValues = (
  values: unknown,
  expectedType: 'boolean' | 'number' | 'text' | 'date',
): void => {
  if (!Array.isArray(values) || values.length === 0) {
    fail('INVALID_VALUE');
  }

  const valuesArray = values as unknown[];

  if (new Set(valuesArray).size !== valuesArray.length) {
    fail('INVALID_VALUE');
  }

  for (const value of valuesArray) {
    if (expectedType === 'boolean' && typeof value !== 'boolean') {
      fail('INVALID_VALUE');
    }
    if (expectedType === 'number' && (typeof value !== 'number' || Number.isNaN(value))) {
      fail('INVALID_VALUE');
    }
    if ((expectedType === 'text' || expectedType === 'date') && typeof value !== 'string') {
      fail('INVALID_VALUE');
    }
    if (expectedType === 'date' && typeof value === 'string' && !isFullDateString(value)) {
      fail('INVALID_VALUE');
    }
  }
};

const validateTextValidation = (validation: Record<string, unknown>): void => {
  const allowedKeys = ['minLength', 'maxLength', 'pattern', 'format', 'oneOf', 'manyOf'];
  for (const key of Object.keys(validation)) {
    if (!allowedKeys.includes(key)) {
      fail('INVALID_VALUE');
    }
  }

  if ('oneOf' in validation && 'manyOf' in validation) {
    fail('INVALID_VALUE');
  }

  if ('minLength' in validation) {
    const minLength = validation.minLength;
    if (!isInteger(minLength) || minLength < 0) {
      fail('INVALID_VALUE');
    }
  }

  if ('maxLength' in validation) {
    const maxLength = validation.maxLength;
    if (!isInteger(maxLength) || maxLength < 0) {
      fail('INVALID_VALUE');
    }
  }

  if ('minLength' in validation && 'maxLength' in validation) {
    const minLength = validation.minLength as number;
    const maxLength = validation.maxLength as number;
    if (minLength > maxLength) {
      fail('INVALID_VALUE');
    }
  }

  if ('pattern' in validation) {
    const pattern = validation.pattern;
    if (typeof pattern !== 'string') {
      fail('INVALID_VALUE');
    }
    try {
      new RegExp(pattern as string);
    } catch {
      fail('INVALID_VALUE');
    }
  }

  if ('format' in validation) {
    const format = validation.format;
    if (
      format !== 'email' &&
      format !== 'phone' &&
      format !== 'credit-card' &&
      format !== 'account-number'
    ) {
      fail('INVALID_VALUE');
    }
  }

  if ('oneOf' in validation) {
    validateSelectionValues(validation.oneOf, 'text');
  }

  if ('manyOf' in validation) {
    validateSelectionValues(validation.manyOf, 'text');
  }
};

const validateNumberValidation = (validation: Record<string, unknown>): void => {
  const allowedKeys = [
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'oneOf',
    'manyOf',
  ];
  for (const key of Object.keys(validation)) {
    if (!allowedKeys.includes(key)) {
      fail('INVALID_VALUE');
    }
  }

  if ('oneOf' in validation && 'manyOf' in validation) {
    fail('INVALID_VALUE');
  }

  if ('minimum' in validation) {
    if (typeof validation.minimum !== 'number' || Number.isNaN(validation.minimum)) {
      fail('INVALID_VALUE');
    }
  }
  if ('maximum' in validation) {
    if (typeof validation.maximum !== 'number' || Number.isNaN(validation.maximum)) {
      fail('INVALID_VALUE');
    }
  }
  if ('exclusiveMinimum' in validation) {
    if (
      typeof validation.exclusiveMinimum !== 'number' ||
      Number.isNaN(validation.exclusiveMinimum)
    ) {
      fail('INVALID_VALUE');
    }
  }
  if ('exclusiveMaximum' in validation) {
    if (
      typeof validation.exclusiveMaximum !== 'number' ||
      Number.isNaN(validation.exclusiveMaximum)
    ) {
      fail('INVALID_VALUE');
    }
  }

  if ('minimum' in validation && 'maximum' in validation) {
    if ((validation.minimum as number) > (validation.maximum as number)) {
      fail('INVALID_VALUE');
    }
  }
  if ('exclusiveMinimum' in validation && 'maximum' in validation) {
    if ((validation.exclusiveMinimum as number) >= (validation.maximum as number)) {
      fail('INVALID_VALUE');
    }
  }
  if ('minimum' in validation && 'exclusiveMaximum' in validation) {
    if ((validation.minimum as number) >= (validation.exclusiveMaximum as number)) {
      fail('INVALID_VALUE');
    }
  }
  if ('exclusiveMinimum' in validation && 'exclusiveMaximum' in validation) {
    if ((validation.exclusiveMinimum as number) >= (validation.exclusiveMaximum as number)) {
      fail('INVALID_VALUE');
    }
  }

  if ('oneOf' in validation) {
    validateSelectionValues(validation.oneOf, 'number');
  }

  if ('manyOf' in validation) {
    validateSelectionValues(validation.manyOf, 'number');
  }
};

const validateBooleanValidation = (validation: Record<string, unknown>): void => {
  const allowedKeys = ['oneOf'];
  for (const key of Object.keys(validation)) {
    if (!allowedKeys.includes(key)) {
      fail('INVALID_VALUE');
    }
  }

  if ('oneOf' in validation) {
    validateSelectionValues(validation.oneOf, 'boolean');
  }
};

const validateDateValidation = (validation: Record<string, unknown>): void => {
  const allowedKeys = ['oneOf', 'manyOf'];
  for (const key of Object.keys(validation)) {
    if (!allowedKeys.includes(key)) {
      fail('INVALID_VALUE');
    }
  }

  if ('oneOf' in validation && 'manyOf' in validation) {
    fail('INVALID_VALUE');
  }

  if ('oneOf' in validation) {
    validateSelectionValues(validation.oneOf, 'date');
  }

  if ('manyOf' in validation) {
    validateSelectionValues(validation.manyOf, 'date');
  }
};

const validateField = (field: unknown): NormalizedWorkflowField => {
  if (!isPlainObject(field)) {
    fail('INVALID_VALUE');
  }

  const fieldRecord = field as Record<string, unknown>;
  const type = fieldRecord.type;
  if (typeof type !== 'string') {
    fail('INVALID_VALUE');
  }

  const normalizedType = type === 'string' ? 'text' : type;
  if (
    normalizedType !== 'boolean' &&
    normalizedType !== 'number' &&
    normalizedType !== 'text' &&
    normalizedType !== 'date'
  ) {
    fail('INVALID_VALUE');
  }

  if (typeof fieldRecord.required !== 'boolean') {
    fail('INVALID_VALUE');
  }

  if (fieldRecord.persist !== undefined && typeof fieldRecord.persist !== 'boolean') {
    fail('INVALID_VALUE');
  }

  const validation = fieldRecord.validation;
  if (validation !== undefined && !isPlainObject(validation)) {
    fail('INVALID_VALUE');
  }

  const validationObject = validation as Record<string, unknown> | undefined;
  if (validationObject !== undefined) {
    if (normalizedType === 'text') {
      validateTextValidation(validationObject);
    } else if (normalizedType === 'number') {
      validateNumberValidation(validationObject);
    } else if (normalizedType === 'boolean') {
      validateBooleanValidation(validationObject);
    } else {
      validateDateValidation(validationObject);
    }
  }

  const required = fieldRecord.required as boolean;
  const persist = (fieldRecord.persist as boolean | undefined) ?? false;
  if (normalizedType === 'boolean') {
    return {
      type: 'boolean',
      required,
      persist,
      validation: validationObject as BooleanValidation | undefined,
    };
  }
  if (normalizedType === 'number') {
    return {
      type: 'number',
      required,
      persist,
      validation: validationObject as NumberValidation | undefined,
    };
  }
  if (normalizedType === 'text') {
    return {
      type: 'text',
      required,
      persist,
      validation: validationObject as TextValidation | undefined,
    };
  }
  if (normalizedType === 'date') {
    return {
      type: 'date',
      required,
      persist,
      validation: validationObject as DateValidation | undefined,
    };
  }

  fail('INVALID_VALUE');
  return {
    type: 'text',
    required,
    persist,
  };
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

const normalizeConnectors = (
  step: RawWorkflowStep,
  workflowFieldNames: Set<string>,
): NormalizedWorkflowConnectorDeclaration[] => {
  const connectors = step.connectors ?? [];
  if (connectors.length === 0) {
    return [];
  }

  const orders = new Set<number>();
  const normalized: NormalizedWorkflowConnectorDeclaration[] = [];

  for (const connector of connectors) {
    if (typeof connector.name !== 'string' || connector.name.trim().length === 0) {
      fail('INVALID_VALUE');
    }
    if (typeof connector.type !== 'string' || connector.type.trim().length === 0) {
      fail('INVALID_VALUE');
    }
    if (!Number.isInteger(connector.order) || connector.order <= 0) {
      fail('INVALID_VALUE');
    }
    if (orders.has(connector.order)) {
      fail('INVALID_VALUE');
    }
    orders.add(connector.order);

    if (
      typeof connector.fieldMapping !== 'object' ||
      connector.fieldMapping === null ||
      Array.isArray(connector.fieldMapping)
    ) {
      fail('INVALID_VALUE');
    }

    for (const [payloadKey, sourceField] of Object.entries(connector.fieldMapping)) {
      if (typeof payloadKey !== 'string' || payloadKey.trim().length === 0) {
        fail('INVALID_VALUE');
      }
      if (typeof sourceField !== 'string' || sourceField.trim().length === 0) {
        fail('INVALID_VALUE');
      }
      if (!workflowFieldNames.has(sourceField)) {
        fail('INVALID_VALUE');
      }
    }

    normalized.push({
      name: connector.name,
      type: connector.type,
      order: connector.order,
      fieldMapping: Object.fromEntries(Object.entries(connector.fieldMapping)),
    });
  }

  normalized.sort((left, right) => left.order - right.order);
  return normalized;
};

const collectWorkflowFieldNames = (steps: RawWorkflowStep[]): Set<string> => {
  const workflowFieldNames = new Set<string>();

  for (const step of steps) {
    for (const fieldName of Object.keys(step.data)) {
      if (workflowFieldNames.has(fieldName)) {
        fail('DUPLICATE_FIELD_NAME');
      }
      workflowFieldNames.add(fieldName);
    }
  }

  return workflowFieldNames;
};

const validateStepCollection = (steps: RawWorkflowStep[], initialName: string): void => {
  const stepNames = new Set<string>();
  const workflowFieldNames = collectWorkflowFieldNames(steps);

  for (const step of steps) {
    if (stepNames.has(step.name)) {
      fail('DUPLICATE_STEP_NAME');
    }
    stepNames.add(step.name);
  }

  for (const step of steps) {
    normalizeConnectors(step, workflowFieldNames);
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
  const workflowFieldNames = collectWorkflowFieldNames(definition.steps);
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
      Object.entries(step.data).map(([fieldName, field]) => [fieldName, validateField(field)]),
    ),
    connectors: normalizeConnectors(step, workflowFieldNames),
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
