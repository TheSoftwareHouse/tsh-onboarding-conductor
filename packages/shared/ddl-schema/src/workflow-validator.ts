import Ajv, { AnySchema } from 'ajv';
import workflowSchema from '../onboarding-workflow.schema.json';
import {
  ArrayValidation,
  BooleanValidation,
  DateValidation,
  NormalizedWorkflowConnectorDeclaration,
  FileValidation,
  NormalizedWorkflowArrayItemField,
  NormalizedWorkflowDefinition,
  NormalizedWorkflowField,
  NormalizedWorkflowNestedField,
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
import {
  collectConditionReferences,
  type NormalizedWorkflowCondition,
  type WorkflowConditionScalar,
} from './workflow-condition';

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

const validator = new Ajv({ strict: true, allowUnionTypes: true }).compile<RawWorkflowDefinition>(
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

type ConditionNormalizationContext = {
  rootFieldNames: ReadonlySet<string>;
  fieldDefinitionsByName: Readonly<Record<string, NormalizedWorkflowField>>;
  currentFieldName?: string;
};

type WorkflowFieldDeclaration = {
  stepName: string;
  persist: boolean;
};

type ConnectorMappingValidationContext = {
  fieldDeclarationsByName: Readonly<Record<string, WorkflowFieldDeclaration>>;
  guaranteedPredecessorsByStepName: Readonly<Record<string, ReadonlySet<string>>>;
};

const isWorkflowConditionScalar = (value: unknown): value is WorkflowConditionScalar => {
  if (value === null) {
    return true;
  }

  return typeof value === 'string' || typeof value === 'boolean' || isFiniteNumber(value);
};

const normalizeConditionLiteral = (value: unknown): WorkflowConditionScalar => {
  if (!isWorkflowConditionScalar(value)) {
    fail('INVALID_VALUE');
  }

  return value as WorkflowConditionScalar;
};

const validateConditionLiteralCompatibility = (
  value: WorkflowConditionScalar,
  field: NormalizedWorkflowField | undefined,
): void => {
  if (field === undefined) {
    fail('INVALID_VALUE');
  }

  const resolvedField = field as NormalizedWorkflowField;

  if (value === null) {
    return;
  }

  if (resolvedField.type === 'text') {
    const textField = resolvedField as Extract<NormalizedWorkflowField, { type: 'text' }>;
    if (textField.validation?.manyOf !== undefined) {
      fail('INVALID_VALUE');
    }

    if (typeof value !== 'string') {
      fail('INVALID_VALUE');
    }

    const allowedValues = textField.validation?.oneOf;
    const stringValue = value as string;
    if (allowedValues !== undefined && !allowedValues.includes(stringValue)) {
      fail('INVALID_VALUE');
    }
    return;
  }

  if (resolvedField.type === 'number') {
    const numberField = resolvedField as Extract<NormalizedWorkflowField, { type: 'number' }>;
    if (numberField.validation?.manyOf !== undefined) {
      fail('INVALID_VALUE');
    }

    if (typeof value !== 'number' || Number.isNaN(value)) {
      fail('INVALID_VALUE');
    }

    const allowedValues = numberField.validation?.oneOf;
    const numberValue = value as number;
    if (allowedValues !== undefined && !allowedValues.includes(numberValue)) {
      fail('INVALID_VALUE');
    }
    return;
  }

  if (resolvedField.type === 'boolean') {
    const booleanField = resolvedField as Extract<NormalizedWorkflowField, { type: 'boolean' }>;
    if (typeof value !== 'boolean') {
      fail('INVALID_VALUE');
    }

    const allowedValues = booleanField.validation?.oneOf;
    const booleanValue = value as boolean;
    if (allowedValues !== undefined && !allowedValues.includes(booleanValue)) {
      fail('INVALID_VALUE');
    }
    return;
  }

  if (resolvedField.type === 'date') {
    const dateField = resolvedField as Extract<NormalizedWorkflowField, { type: 'date' }>;
    if (dateField.validation?.manyOf !== undefined) {
      fail('INVALID_VALUE');
    }

    if (typeof value !== 'string' || !isFullDateString(value)) {
      fail('INVALID_VALUE');
    }

    const allowedValues = dateField.validation?.oneOf;
    const dateValue = value as string;
    if (allowedValues !== undefined && !allowedValues.includes(dateValue)) {
      fail('INVALID_VALUE');
    }
    return;
  }

  fail('INVALID_VALUE');
};

const normalizeCondition = (
  condition: unknown,
  context: ConditionNormalizationContext,
): NormalizedWorkflowCondition | undefined => {
  if (condition === undefined) {
    return undefined;
  }

  if (!isPlainObject(condition)) {
    fail('INVALID_SHAPE');
  }

  const conditionRecord = condition as Record<string, unknown>;
  const keys = Object.keys(conditionRecord);
  const unknownKeys = keys.filter(
    (key) => !['all', 'any', 'not', 'field', 'equals', 'in', 'isSet'].includes(key),
  );
  if (unknownKeys.length > 0) {
    fail('UNKNOWN_PROPERTY');
  }

  if ('all' in conditionRecord) {
    if (keys.length !== 1) {
      fail('INVALID_SHAPE');
    }

    const branch = conditionRecord.all as readonly unknown[];
    if (!Array.isArray(branch) || branch.length === 0) {
      fail('INVALID_SHAPE');
    }

    return {
      all: branch.map((childCondition: unknown) =>
        normalizeCondition(childCondition, context),
      ) as NormalizedWorkflowCondition[],
    };
  }

  if ('any' in conditionRecord) {
    if (keys.length !== 1) {
      fail('INVALID_SHAPE');
    }

    const branch = conditionRecord.any as readonly unknown[];
    if (!Array.isArray(branch) || branch.length === 0) {
      fail('INVALID_SHAPE');
    }

    return {
      any: branch.map((childCondition: unknown) =>
        normalizeCondition(childCondition, context),
      ) as NormalizedWorkflowCondition[],
    };
  }

  if ('not' in conditionRecord) {
    if (keys.length !== 1) {
      fail('INVALID_SHAPE');
    }

    return {
      not: normalizeCondition(conditionRecord.not, context) as NormalizedWorkflowCondition,
    };
  }

  if ('field' in conditionRecord) {
    const operatorKeys = keys.filter((key) => key === 'equals' || key === 'in' || key === 'isSet');
    if (keys.length < 2 || keys.length > 2 || operatorKeys.length !== 1) {
      fail('INVALID_SHAPE');
    }

    const fieldName = conditionRecord.field;
    if (typeof fieldName !== 'string' || fieldName.trim().length === 0) {
      fail('INVALID_VALUE');
    }

    const referencedFieldName = fieldName as string;
    if (!context.rootFieldNames.has(referencedFieldName)) {
      fail('INVALID_VALUE');
    }
    if (
      context.currentFieldName !== undefined &&
      referencedFieldName === context.currentFieldName
    ) {
      fail('INVALID_VALUE');
    }

    const referencedField = context.fieldDefinitionsByName[referencedFieldName];
    if (referencedField === undefined) {
      fail('INVALID_VALUE');
    }

    const operator = operatorKeys[0] as 'equals' | 'in' | 'isSet';
    if (operator === 'isSet') {
      if (typeof conditionRecord.isSet !== 'boolean') {
        fail('INVALID_VALUE');
      }
      return {
        field: referencedFieldName,
        isSet: conditionRecord.isSet as boolean,
      };
    }

    if (operator === 'equals') {
      const normalizedLiteral = normalizeConditionLiteral(conditionRecord.equals);
      validateConditionLiteralCompatibility(normalizedLiteral, referencedField);
      return {
        field: referencedFieldName,
        equals: normalizedLiteral,
      };
    }

    const values = conditionRecord.in as readonly unknown[];
    if (!Array.isArray(values) || values.length === 0) {
      fail('INVALID_SHAPE');
    }

    const normalizedValues = values.map((value: unknown) => {
      const normalizedValue = normalizeConditionLiteral(value);
      validateConditionLiteralCompatibility(normalizedValue, referencedField);
      return normalizedValue;
    });

    return {
      field: referencedFieldName,
      in: normalizedValues,
    };
  }

  fail('INVALID_SHAPE');
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
      format !== 'account-number' &&
      format !== 'uuid' &&
      format !== 'uri' &&
      format !== 'phone'
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

const validateArrayValidation = (validation: Record<string, unknown>): void => {
  const allowedKeys = ['minItems', 'maxItems'];
  for (const key of Object.keys(validation)) {
    if (!allowedKeys.includes(key)) {
      fail('INVALID_VALUE');
    }
  }

  if ('minItems' in validation) {
    const minItems = validation.minItems;
    if (!isInteger(minItems) || minItems < 0) {
      fail('INVALID_VALUE');
    }
  }

  if ('maxItems' in validation) {
    const maxItems = validation.maxItems;
    if (!isInteger(maxItems) || maxItems < 0) {
      fail('INVALID_VALUE');
    }
  }

  if ('minItems' in validation && 'maxItems' in validation) {
    const minItems = validation.minItems as number;
    const maxItems = validation.maxItems as number;
    if (minItems > maxItems) {
      fail('INVALID_VALUE');
    }
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

type FieldValidationOptions = {
  requireRequired: boolean;
  allowPersist: boolean;
  allowFile: boolean;
};

const normalizeFieldType = (type: unknown): string => {
  if (typeof type !== 'string') {
    fail('INVALID_VALUE');
  }

  const rawType = type as string;
  const normalizedType = rawType === 'string' ? 'text' : rawType;
  if (
    normalizedType !== 'boolean' &&
    normalizedType !== 'number' &&
    normalizedType !== 'text' &&
    normalizedType !== 'date' &&
    normalizedType !== 'file' &&
    normalizedType !== 'object' &&
    normalizedType !== 'array'
  ) {
    fail('INVALID_VALUE');
  }

  return normalizedType;
};

const normalizeFileValidation = (validation: Record<string, unknown>): FileValidation => {
  return {
    ...(validation as FileValidation),
    contentTypes: ((validation as FileValidation).contentTypes as string[]).map((contentType) =>
      contentType.trim().toLowerCase(),
    ),
  };
};

const validateFieldInternal = (
  field: unknown,
  options: FieldValidationOptions,
): NormalizedWorkflowField | NormalizedWorkflowNestedField | NormalizedWorkflowArrayItemField => {
  if (!isPlainObject(field)) {
    fail('INVALID_VALUE');
  }

  const fieldRecord = field as Record<string, unknown>;
  const normalizedType = normalizeFieldType(fieldRecord.type);

  if (!options.allowFile && normalizedType === 'file') {
    fail('INVALID_VALUE');
  }

  if (options.requireRequired) {
    if (typeof fieldRecord.required !== 'boolean') {
      fail('INVALID_VALUE');
    }
  } else if (Object.prototype.hasOwnProperty.call(fieldRecord, 'required')) {
    fail('INVALID_VALUE');
  }

  if (Object.prototype.hasOwnProperty.call(fieldRecord, 'persist')) {
    if (!options.allowPersist || typeof fieldRecord.persist !== 'boolean') {
      fail('INVALID_VALUE');
    }
  }

  const validation = fieldRecord.validation;
  if (validation !== undefined && !isPlainObject(validation)) {
    fail('INVALID_VALUE');
  }

  const validationObject = validation as Record<string, unknown> | undefined;
  const required = options.requireRequired ? (fieldRecord.required as boolean) : undefined;
  const persist = options.allowPersist
    ? ((fieldRecord.persist as boolean | undefined) ?? true)
    : undefined;

  if (normalizedType === 'object') {
    if (validationObject !== undefined) {
      fail('INVALID_VALUE');
    }

    const fields = fieldRecord.fields;
    if (!isPlainObject(fields)) {
      fail('INVALID_VALUE');
    }

    const fieldEntries = Object.entries(fields as Record<string, unknown>);
    if (fieldEntries.length === 0) {
      fail('INVALID_VALUE');
    }

    const normalizedFields: Record<string, NormalizedWorkflowNestedField> = {};
    for (const [fieldName, nestedField] of fieldEntries) {
      if (fieldName.trim().length === 0) {
        fail('INVALID_VALUE');
      }
      normalizedFields[fieldName] = validateFieldInternal(nestedField, {
        requireRequired: true,
        allowPersist: false,
        allowFile: false,
      }) as NormalizedWorkflowNestedField;
    }

    return {
      type: 'object',
      ...(options.requireRequired ? { required } : {}),
      ...(options.allowPersist ? { persist } : {}),
      fields: normalizedFields,
    } as NormalizedWorkflowField | NormalizedWorkflowNestedField | NormalizedWorkflowArrayItemField;
  }

  if (normalizedType === 'array') {
    if (validationObject !== undefined) {
      validateArrayValidation(validationObject);
    }

    if (!Object.prototype.hasOwnProperty.call(fieldRecord, 'items')) {
      fail('INVALID_VALUE');
    }

    const items = validateFieldInternal(fieldRecord.items, {
      requireRequired: false,
      allowPersist: false,
      allowFile: false,
    }) as NormalizedWorkflowArrayItemField;

    return {
      type: 'array',
      ...(options.requireRequired ? { required } : {}),
      ...(options.allowPersist ? { persist } : {}),
      items,
      ...(validationObject !== undefined
        ? { validation: validationObject as ArrayValidation }
        : {}),
    } as NormalizedWorkflowField | NormalizedWorkflowNestedField | NormalizedWorkflowArrayItemField;
  }

  if (validationObject !== undefined) {
    if (normalizedType === 'text') {
      validateTextValidation(validationObject);
    } else if (normalizedType === 'number') {
      validateNumberValidation(validationObject);
    } else if (normalizedType === 'boolean') {
      validateBooleanValidation(validationObject);
    } else if (normalizedType === 'date') {
      validateDateValidation(validationObject);
    } else if (normalizedType === 'file') {
      validateFileValidation(validationObject);
    }
  }

  if (normalizedType === 'file') {
    const fileValidation = validationObject;
    if (!options.requireRequired || required !== true) {
      fail('INVALID_VALUE');
    }
    if (fileValidation === undefined) {
      fail('INVALID_VALUE');
    }

    return {
      type: 'file',
      ...(options.requireRequired ? { required } : {}),
      ...(options.allowPersist ? { persist } : {}),
      validation: normalizeFileValidation(fileValidation as Record<string, unknown>),
    } as NormalizedWorkflowField;
  }

  if (normalizedType === 'boolean') {
    return {
      type: 'boolean',
      ...(options.requireRequired ? { required } : {}),
      ...(options.allowPersist ? { persist } : {}),
      ...(validationObject !== undefined
        ? { validation: validationObject as BooleanValidation }
        : {}),
    } as NormalizedWorkflowField | NormalizedWorkflowNestedField | NormalizedWorkflowArrayItemField;
  }

  if (normalizedType === 'number') {
    return {
      type: 'number',
      ...(options.requireRequired ? { required } : {}),
      ...(options.allowPersist ? { persist } : {}),
      ...(validationObject !== undefined
        ? { validation: validationObject as NumberValidation }
        : {}),
    } as NormalizedWorkflowField | NormalizedWorkflowNestedField | NormalizedWorkflowArrayItemField;
  }

  if (normalizedType === 'text') {
    return {
      type: 'text',
      ...(options.requireRequired ? { required } : {}),
      ...(options.allowPersist ? { persist } : {}),
      ...(validationObject !== undefined ? { validation: validationObject as TextValidation } : {}),
    } as NormalizedWorkflowField | NormalizedWorkflowNestedField | NormalizedWorkflowArrayItemField;
  }

  if (normalizedType === 'date') {
    return {
      type: 'date',
      ...(options.requireRequired ? { required } : {}),
      ...(options.allowPersist ? { persist } : {}),
      ...(validationObject !== undefined ? { validation: validationObject as DateValidation } : {}),
    } as NormalizedWorkflowField | NormalizedWorkflowNestedField | NormalizedWorkflowArrayItemField;
  }

  return fail('INVALID_VALUE');
};

const validateField = (field: unknown): NormalizedWorkflowField => {
  return validateFieldInternal(field, {
    requireRequired: true,
    allowPersist: true,
    allowFile: true,
  }) as NormalizedWorkflowField;
};

const normalizeTransition = (
  transition: RawWorkflowStep['transitions'][number],
  context: ConditionNormalizationContext,
): NormalizedWorkflowTransition => {
  const normalizedWhen =
    transition.when === undefined ? undefined : normalizeCondition(transition.when, context);

  return {
    status: transition.status,
    target: transition.target,
    ...(normalizedWhen === undefined ? {} : { when: normalizedWhen }),
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
        fail('INVALID_SHAPE');
      }
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
  connectorValidationContext: ConnectorMappingValidationContext,
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
    const async = connector.async ?? false;
    if (typeof async !== 'boolean') {
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

      const sourceDeclaration = connectorValidationContext.fieldDeclarationsByName[sourceField];
      if (sourceDeclaration === undefined) {
        fail('INVALID_VALUE');
      }

      if (sourceDeclaration.stepName !== step.name) {
        const guaranteedPredecessors =
          connectorValidationContext.guaranteedPredecessorsByStepName[step.name];
        if (guaranteedPredecessors === undefined) {
          fail('INVALID_VALUE');
        }

        if (!guaranteedPredecessors.has(sourceDeclaration.stepName)) {
          fail('INVALID_VALUE');
        }

        if (!sourceDeclaration.persist) {
          fail('INVALID_VALUE');
        }
      }
    }

    normalized.push({
      name: connector.name,
      type: connector.type,
      canReject,
      async,
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

const collectWorkflowFieldDeclarations = (
  steps: readonly RawWorkflowStep[],
): Record<string, WorkflowFieldDeclaration> => {
  const declarationsByName: Record<string, WorkflowFieldDeclaration> = {};

  for (const step of steps) {
    for (const [fieldName, field] of Object.entries(step.data)) {
      if (declarationsByName[fieldName] !== undefined) {
        fail('DUPLICATE_FIELD_NAME');
      }

      declarationsByName[fieldName] = {
        stepName: step.name,
        persist: field.persist !== false,
      };
    }
  }

  return declarationsByName;
};

const buildGuaranteedPredecessorsByStepName = (
  steps: readonly RawWorkflowStep[],
  initialStepName: string,
): Record<string, ReadonlySet<string>> => {
  const allStepNames = steps.map((step) => step.name);
  const allStepNameSet = new Set(allStepNames);
  const predecessorsByStepName = new Map<string, Set<string>>();

  for (const stepName of allStepNames) {
    predecessorsByStepName.set(stepName, new Set());
  }

  for (const step of steps) {
    for (const transition of step.transitions) {
      if (typeof transition.target !== 'string') {
        continue;
      }

      if (!allStepNameSet.has(transition.target)) {
        continue;
      }

      const predecessors = predecessorsByStepName.get(transition.target);
      if (predecessors === undefined) {
        continue;
      }

      predecessors.add(step.name);
    }
  }

  const dominatorsByStepName = new Map<string, Set<string>>();
  for (const stepName of allStepNames) {
    dominatorsByStepName.set(
      stepName,
      stepName === initialStepName ? new Set([stepName]) : new Set(allStepNames),
    );
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (const stepName of allStepNames) {
      if (stepName === initialStepName) {
        continue;
      }

      const predecessors = predecessorsByStepName.get(stepName);
      if (!predecessors || predecessors.size === 0) {
        const nextDominators = new Set([stepName]);
        if (!areStringSetsEqual(nextDominators, dominatorsByStepName.get(stepName) ?? new Set())) {
          dominatorsByStepName.set(stepName, nextDominators);
          changed = true;
        }
        continue;
      }

      let intersection: Set<string> | null = null;
      for (const predecessor of predecessors) {
        const predecessorDominators = dominatorsByStepName.get(predecessor);
        if (!predecessorDominators) {
          continue;
        }

        if (intersection === null) {
          intersection = new Set(predecessorDominators);
          continue;
        }

        for (const candidate of Array.from(intersection)) {
          if (!predecessorDominators.has(candidate)) {
            intersection.delete(candidate);
          }
        }
      }

      const nextDominators = new Set<string>([stepName]);
      for (const dominator of intersection ?? []) {
        nextDominators.add(dominator);
      }

      if (!areStringSetsEqual(nextDominators, dominatorsByStepName.get(stepName) ?? new Set())) {
        dominatorsByStepName.set(stepName, nextDominators);
        changed = true;
      }
    }
  }

  const guaranteedPredecessorsByStepName: Record<string, ReadonlySet<string>> = {};
  for (const stepName of allStepNames) {
    const dominators = dominatorsByStepName.get(stepName) ?? new Set<string>([stepName]);
    const predecessors = new Set(
      Array.from(dominators).filter((dominatorStepName) => dominatorStepName !== stepName),
    );
    guaranteedPredecessorsByStepName[stepName] = predecessors;
  }

  return guaranteedPredecessorsByStepName;
};

const areStringSetsEqual = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean => {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
};

const validateStepCollection = (steps: RawWorkflowStep[], initialName: string): void => {
  const stepNames = new Set<string>();

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

    for (const transition of step.transitions) {
      const isManualOutcome =
        transition.status === 'manual.approve' ||
        transition.status === 'manual.reject' ||
        transition.status === 'manual.invalid';

      if (transition.target !== undefined) {
        if (typeof transition.target !== 'string' || transition.target.trim().length === 0) {
          fail('INVALID_VALUE');
        }

        if (isManualOutcome && transition.target === step.name) {
          fail('INVALID_TRANSITIONS');
        }

        if (!isManualOutcome && !stepNames.has(transition.target)) {
          fail('UNKNOWN_TARGET');
        }
      } else if (isManualOutcome) {
        fail('INVALID_SHAPE');
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

const validateTransitionGroups = (
  steps: readonly NormalizedWorkflowStep[],
  stepsByName: Readonly<Record<string, NormalizedWorkflowStep>>,
): void => {
  for (const step of steps) {
    const connectorCanReject = step.connectors.some((connector) => connector.canReject);
    const rejectedTransitions = step.transitions.filter(
      (transition) => transition.status === 'rejected',
    );
    if (connectorCanReject) {
      if (rejectedTransitions.length === 0) {
        fail('INVALID_TRANSITIONS');
      }

      for (const transition of rejectedTransitions) {
        if (transition.target === undefined) {
          fail('INVALID_TRANSITIONS');
        }
        const targetName = transition.target as string;
        const targetStep = stepsByName[targetName];
        if (targetStep === undefined || targetStep.status !== 'rejected') {
          fail('INVALID_TRANSITIONS');
        }
      }
    } else if (rejectedTransitions.length > 0) {
      for (const transition of rejectedTransitions) {
        if (transition.target !== undefined && transition.target !== step.name) {
          fail('INVALID_TRANSITIONS');
        }
      }
    }

    const groupedTransitions = new Map<string, NormalizedWorkflowTransition[]>();
    for (const transition of step.transitions) {
      const groupTransitions = groupedTransitions.get(transition.status) ?? [];
      groupTransitions.push(transition);
      groupedTransitions.set(transition.status, groupTransitions);
    }

    for (const transitions of groupedTransitions.values()) {
      const conditionalTransitions = transitions.filter(
        (transition) => transition.when !== undefined,
      );
      const unconditionalTransitions = transitions.filter(
        (transition) => transition.when === undefined,
      );

      if (transitions.length > 1) {
        if (
          (transitions[0].status === 'success' || transitions[0].status === 'rejected') &&
          conditionalTransitions.length > 0
        ) {
          if (
            unconditionalTransitions.length !== 1 ||
            unconditionalTransitions[0] !== transitions[transitions.length - 1]
          ) {
            fail('INVALID_TRANSITIONS');
          }
        } else if (
          transitions[0].status === 'manual.approve' ||
          transitions[0].status === 'manual.reject' ||
          transitions[0].status === 'manual.invalid'
        ) {
          if (unconditionalTransitions.length > 1) {
            fail('INVALID_TRANSITIONS');
          }
          if (
            unconditionalTransitions.length === 1 &&
            unconditionalTransitions[0] !== transitions[transitions.length - 1]
          ) {
            fail('INVALID_TRANSITIONS');
          }
        } else if (unconditionalTransitions.length > 1) {
          fail('DUPLICATE_TRANSITION');
        }
      }

      if (
        (transitions[0].status === 'success' || transitions[0].status === 'rejected') &&
        conditionalTransitions.length > 0 &&
        unconditionalTransitions.length !== 1
      ) {
        fail('INVALID_TRANSITIONS');
      }

      if (
        (transitions[0].status === 'success' || transitions[0].status === 'rejected') &&
        conditionalTransitions.length > 0 &&
        transitions[transitions.length - 1].when === undefined
      ) {
        continue;
      }

      if (
        (transitions[0].status === 'success' || transitions[0].status === 'rejected') &&
        conditionalTransitions.length > 0 &&
        transitions[transitions.length - 1].when !== undefined
      ) {
        fail('INVALID_TRANSITIONS');
      }

      if (
        (transitions[0].status === 'success' || transitions[0].status === 'rejected') &&
        conditionalTransitions.length === 0 &&
        transitions.length > 1
      ) {
        fail('DUPLICATE_TRANSITION');
      }
    }
  }
};

export const validateAndNormalizeWorkflow = (input: unknown): NormalizedWorkflowDefinition => {
  const definition = validateSchema(input);
  const workflowFieldNames = collectWorkflowFieldNames(definition.steps);
  const fieldDeclarationsByName = collectWorkflowFieldDeclarations(definition.steps);
  const rawStepsByName = Object.fromEntries(
    definition.steps.map((step) => [step.name, step]),
  ) as Record<string, RawWorkflowStep>;
  const stepNames = new Set(definition.steps.map((step) => step.name));
  const initial = definition.initial ?? definition.steps[0]?.name;

  if (!initial || !stepNames.has(initial)) {
    fail('INVALID_VALUE');
  }

  validateStepCollection(definition.steps, initial);

  const connectorMappingValidationContext: ConnectorMappingValidationContext = {
    fieldDeclarationsByName,
    guaranteedPredecessorsByStepName: buildGuaranteedPredecessorsByStepName(
      definition.steps,
      initial,
    ),
  };

  const workflowFieldDefinitionsByName: Record<string, NormalizedWorkflowField> = {};
  const conditionContext: ConditionNormalizationContext = {
    rootFieldNames: workflowFieldNames,
    fieldDefinitionsByName: workflowFieldDefinitionsByName,
  };

  const normalizedStepEntries = definition.steps.map((step) => {
    const normalizedData = Object.fromEntries(
      Object.entries(step.data).map(([fieldName, field]) => {
        const normalizedField = validateField(field);
        workflowFieldDefinitionsByName[fieldName] = normalizedField;
        return [fieldName, normalizedField];
      }),
    );

    return {
      rawStep: step,
      normalizedData,
    };
  });

  const steps: NormalizedWorkflowStep[] = normalizedStepEntries.map(
    ({ rawStep, normalizedData }) => ({
      name: rawStep.name,
      status: rawStep.status as WorkflowStatus,
      data: normalizedData,
      connectors: normalizeConnectors(
        rawStep,
        workflowFieldNames,
        rawStepsByName,
        connectorMappingValidationContext,
      ),
      transitions: [],
      terminal:
        rawStep.status === 'approved' ||
        rawStep.status === 'rejected' ||
        rawStep.status === 'invalid',
    }),
  );

  const stepsByName: Record<string, NormalizedWorkflowStep> = {};
  for (const step of steps) {
    stepsByName[step.name] = step;
  }

  for (const { rawStep, normalizedData } of normalizedStepEntries) {
    const step = stepsByName[rawStep.name];
    if (!step) {
      fail('INVALID_VALUE');
    }

    const nextData = Object.fromEntries(
      Object.entries(normalizedData).map(([fieldName, normalizedField]) => {
        const rawField = rawStep.data[fieldName];
        if (rawField !== undefined && Object.prototype.hasOwnProperty.call(rawField, 'when')) {
          const normalizedWhen = normalizeCondition(rawField.when, {
            ...conditionContext,
            currentFieldName: fieldName,
          });
          (
            normalizedField as NormalizedWorkflowField & { when?: NormalizedWorkflowCondition }
          ).when = normalizedWhen;
        }
        return [fieldName, normalizedField];
      }),
    );

    step.data = nextData as typeof step.data;
    step.transitions = rawStep.transitions.map((transition) =>
      normalizeTransition(transition, {
        ...conditionContext,
        currentFieldName: undefined,
      }),
    );
  }

  validateTransitionGroups(steps, stepsByName);

  // Validate field dependency cycles after all field conditions are normalized.
  const dependencyState = new Map<string, 'visiting' | 'visited'>();
  const visitFieldDependencies = (fieldName: string): void => {
    const state = dependencyState.get(fieldName);
    if (state === 'visiting') {
      fail('INVALID_VALUE');
    }
    if (state === 'visited') {
      return;
    }

    dependencyState.set(fieldName, 'visiting');
    const field = workflowFieldDefinitionsByName[fieldName];
    if (field?.when !== undefined) {
      for (const dependency of collectConditionReferences(field.when)) {
        if (workflowFieldDefinitionsByName[dependency] !== undefined) {
          visitFieldDependencies(dependency);
        }
      }
    }
    dependencyState.set(fieldName, 'visited');
  };

  for (const fieldName of Object.keys(workflowFieldDefinitionsByName)) {
    visitFieldDependencies(fieldName);
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
