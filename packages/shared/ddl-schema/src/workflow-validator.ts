import Ajv, { AnySchema } from 'ajv';
import workflowSchema from '../onboarding-workflow.schema.json';
import {
  BooleanValidation,
  DateValidation,
  NormalizedWorkflowConnectorDeclaration,
  FileValidation,
  NormalizedWorkflowDefinition,
  NormalizedWorkflowField,
  NormalizedWorkflowNotifyWebhookDeclaration,
  NormalizedWorkflowRootWebhookDeclaration,
  NormalizedWorkflowTransition,
  NormalizedWorkflowTransitionWebhookDeclaration,
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

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value);
};

const isJsonCompatibleValue = (value: unknown): boolean => {
  if (value === null) {
    return true;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }

  if (isFiniteNumber(value)) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonCompatibleValue(item));
  }

  if (isPlainObject(value)) {
    return Object.values(value).every((entry) => isJsonCompatibleValue(entry));
  }

  return false;
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
    if (format !== 'email' && format !== 'credit-card' && format !== 'account-number') {
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

const validateFileValidation = (validation: Record<string, unknown>): void => {
  const allowedKeys = ['contentTypes', 'maxSizeBytes', 'maxImageWidth', 'maxImageHeight'];
  for (const key of Object.keys(validation)) {
    if (!allowedKeys.includes(key)) {
      fail('INVALID_VALUE');
    }
  }

  if (!('contentTypes' in validation) || !('maxSizeBytes' in validation)) {
    fail('INVALID_VALUE');
  }

  const contentTypes = validation.contentTypes;
  if (!Array.isArray(contentTypes) || contentTypes.length === 0) {
    fail('INVALID_VALUE');
  }

  const contentTypesArray = contentTypes as unknown[];
  const normalizedContentTypes: string[] = [];
  for (const contentType of contentTypesArray) {
    if (typeof contentType !== 'string') {
      fail('INVALID_VALUE');
    }

    const normalizedContentType = (contentType as string).trim().toLowerCase();
    if (normalizedContentType.length === 0) {
      fail('INVALID_VALUE');
    }
    normalizedContentTypes.push(normalizedContentType);
  }

  if (new Set(normalizedContentTypes).size !== normalizedContentTypes.length) {
    fail('INVALID_VALUE');
  }

  const maxSizeBytes = validation.maxSizeBytes;
  if (!isInteger(maxSizeBytes) || maxSizeBytes < 1 || maxSizeBytes > Number.MAX_SAFE_INTEGER) {
    fail('INVALID_VALUE');
  }

  if ('maxImageWidth' in validation) {
    const maxImageWidth = validation.maxImageWidth;
    if (!isInteger(maxImageWidth) || maxImageWidth < 1) {
      fail('INVALID_VALUE');
    }
  }

  if ('maxImageHeight' in validation) {
    const maxImageHeight = validation.maxImageHeight;
    if (!isInteger(maxImageHeight) || maxImageHeight < 1) {
      fail('INVALID_VALUE');
    }
  }

  const allImages = normalizedContentTypes.every((contentType) => contentType.startsWith('image/'));
  if (('maxImageWidth' in validation || 'maxImageHeight' in validation) && !allImages) {
    fail('INVALID_VALUE');
  }
};

const webhookPathSegmentPattern = /^[A-Za-z0-9._~-]+$/;

const normalizeAndValidateNotifyWebhook = (
  webhook: unknown,
): NormalizedWorkflowNotifyWebhookDeclaration => {
  if (!isPlainObject(webhook)) {
    fail('INVALID_VALUE');
  }

  const webhookRecord = webhook as Record<string, unknown>;

  if (typeof webhookRecord.path !== 'string') {
    fail('INVALID_VALUE');
  }
  const normalizedPath = webhookRecord.path as string;

  if (normalizedPath.length === 0 || normalizedPath.trim() !== normalizedPath) {
    fail('INVALID_VALUE');
  }

  const segments = normalizedPath.split('/');
  if (segments.length === 0) {
    fail('INVALID_VALUE');
  }

  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      fail('INVALID_VALUE');
    }

    if (!webhookPathSegmentPattern.test(segment)) {
      fail('INVALID_VALUE');
    }
  }

  return {
    path: normalizedPath,
  };
};

const normalizeAndValidateRootWebhook = (
  webhook: unknown,
): NormalizedWorkflowRootWebhookDeclaration => {
  if (!isPlainObject(webhook)) {
    fail('INVALID_VALUE');
  }

  const webhookRecord = webhook as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(webhookRecord, 'notify')) {
    fail('INVALID_VALUE');
  }

  return {
    notify: normalizeAndValidateNotifyWebhook(webhookRecord.notify),
  };
};

const normalizeAndValidateTransitionWebhook = (
  webhook: unknown,
): NormalizedWorkflowTransitionWebhookDeclaration => {
  if (!isPlainObject(webhook)) {
    fail('INVALID_VALUE');
  }

  const webhookRecord = webhook as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(webhookRecord, 'notify')) {
    fail('INVALID_VALUE');
  }

  if (webhookRecord.notify !== false) {
    fail('INVALID_VALUE');
  }

  return {
    notify: false,
  };
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
    normalizedType !== 'date' &&
    normalizedType !== 'file'
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
    } else if (normalizedType === 'date') {
      validateDateValidation(validationObject);
    } else {
      validateFileValidation(validationObject);
    }
  }

  const required = fieldRecord.required as boolean;
  const persist = (fieldRecord.persist as boolean | undefined) ?? true;
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
  if (normalizedType === 'file') {
    if (required !== true || validationObject === undefined) {
      fail('INVALID_VALUE');
    }

    const normalizedFileValidation: FileValidation = {
      ...(validationObject as FileValidation),
      contentTypes: ((validationObject as FileValidation).contentTypes as string[]).map(
        (contentType) => contentType.trim().toLowerCase(),
      ),
    };

    return {
      type: 'file',
      required,
      persist,
      validation: normalizedFileValidation,
    };
  }

  fail('INVALID_VALUE');
  return {
    type: 'text',
    required,
    persist,
  };
};

const normalizeTransition = (
  transition: RawWorkflowStep['transitions'][number],
): NormalizedWorkflowTransition => {
  return {
    status: transition.status,
    target: transition.target,
    webhook:
      transition.webhook === undefined
        ? undefined
        : normalizeAndValidateTransitionWebhook(transition.webhook),
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

const normalizeConnectorConfig = (config: unknown): Record<string, unknown> => {
  if (config !== undefined && !isPlainObject(config)) {
    fail('INVALID_VALUE');
  }

  const configObject = (config as Record<string, unknown> | undefined) ?? {};

  if (!isJsonCompatibleValue(configObject)) {
    fail('INVALID_VALUE');
  }

  return { ...configObject };
};

const validateConnectorRejectionTransitions = (
  step: RawWorkflowStep,
  normalizedConnectors: readonly NormalizedWorkflowConnectorDeclaration[],
  stepsByName: Readonly<Record<string, RawWorkflowStep>>,
): void => {
  const rejectedTransition = step.transitions.find(
    (transition) => transition.status === 'rejected',
  );

  const hasRejectingConnector = normalizedConnectors.some((connector) => connector.canReject);

  if (!hasRejectingConnector) {
    if (rejectedTransition) {
      fail('INVALID_TRANSITIONS');
    }
    return;
  }

  if (!rejectedTransition) {
    fail('INVALID_TRANSITIONS');
  }

  const resolvedRejectedTransition = rejectedTransition as { target?: string };

  if (
    typeof resolvedRejectedTransition.target !== 'string' ||
    resolvedRejectedTransition.target.trim().length === 0
  ) {
    fail('INVALID_TRANSITIONS');
  }

  const rejectedTargetName = resolvedRejectedTransition.target as string;
  const rejectedTarget = stepsByName[rejectedTargetName];
  if (!rejectedTarget || rejectedTarget.status !== 'rejected') {
    fail('INVALID_TRANSITIONS');
  }
};

const normalizeConnectors = (
  step: RawWorkflowStep,
  workflowFieldNames: Set<string>,
  stepsByName: Readonly<Record<string, RawWorkflowStep>>,
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

    const canReject = connector.canReject ?? false;
    if (typeof canReject !== 'boolean') {
      fail('INVALID_VALUE');
    }
    const config = normalizeConnectorConfig(connector.config);

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
      canReject,
      order: connector.order,
      fieldMapping: Object.fromEntries(Object.entries(connector.fieldMapping)),
      config,
    });
  }

  normalized.sort((left, right) => left.order - right.order);
  validateConnectorRejectionTransitions(step, normalized, stepsByName);
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
  const stepsByName = Object.fromEntries(steps.map((step) => [step.name, step])) as Record<
    string,
    RawWorkflowStep
  >;

  for (const step of steps) {
    if (stepNames.has(step.name)) {
      fail('DUPLICATE_STEP_NAME');
    }
    stepNames.add(step.name);

    const fileFieldCount = Object.values(step.data).filter(
      (field) => isPlainObject(field) && (field as Record<string, unknown>).type === 'file',
    ).length;

    if (fileFieldCount > 1) {
      fail('INVALID_VALUE');
    }

    normalizeConnectors(step, workflowFieldNames, stepsByName);
  }

  const initialStep = steps.find((step) => step.name === initialName);
  if (!initialStep) {
    fail('INVALID_VALUE');
  }
  const resolvedInitialStep = initialStep as RawWorkflowStep;

  for (const step of steps) {
    if (step.status === 'approved' || step.status === 'rejected' || step.status === 'invalid') {
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
      if (transition.target !== undefined) {
        if (typeof transition.target !== 'string' || transition.target.trim().length === 0) {
          fail('INVALID_VALUE');
        }

        const isManualOutcome =
          transition.status === 'manual.approve' ||
          transition.status === 'manual.reject' ||
          transition.status === 'manual.invalid';

        if (isManualOutcome && transition.target === step.name) {
          fail('INVALID_TRANSITIONS');
        }

        if (!stepNames.has(transition.target)) {
          fail('UNKNOWN_TARGET');
        }
      }

      if (transition.webhook !== undefined) {
        normalizeAndValidateTransitionWebhook(transition.webhook);
      }
    }

    if (step.transitions.length < 1) {
      fail('INVALID_TRANSITIONS');
    }
  }

  if (
    resolvedInitialStep.status === 'approved' ||
    resolvedInitialStep.status === 'rejected' ||
    resolvedInitialStep.status === 'invalid'
  ) {
    fail('INVALID_TERMINAL_STEP');
  }
};

export const validateAndNormalizeWorkflow = (input: unknown): NormalizedWorkflowDefinition => {
  const definition = validateSchema(input);
  const workflowFieldNames = collectWorkflowFieldNames(definition.steps);
  const rawStepsByName = Object.fromEntries(
    definition.steps.map((step) => [step.name, step]),
  ) as Record<string, RawWorkflowStep>;
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
    connectors: normalizeConnectors(step, workflowFieldNames, rawStepsByName),
    transitions: step.transitions.map(normalizeTransition),
    terminal: step.status === 'approved' || step.status === 'rejected' || step.status === 'invalid',
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
    webhook:
      definition.webhook === undefined
        ? undefined
        : normalizeAndValidateRootWebhook(definition.webhook),
    steps,
    stepsByName,
  };
};
