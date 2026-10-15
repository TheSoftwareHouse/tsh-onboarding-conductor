import { failWorkflow } from '../workflow-invalid.error';
import { isPlainObject } from '../value-guards';
import type {
  AnyNormalizedField,
  FieldNormalizationContext,
  WorkflowFieldLevel,
} from './field-type.port';
import {
  getFieldTypeRegistry,
  getFieldType,
  type WorkflowFieldTypeRegistry,
} from './field-type.registry';

/** `required` is declared everywhere except inside an array's `items`. */
const includesRequired = (level: WorkflowFieldLevel): boolean => level !== 'arrayItem';

/** `persist` is a step-data concern, so only root fields may declare it. */
const includesPersist = (level: WorkflowFieldLevel): boolean => level === 'root';

/**
 * Validates and normalizes one field descriptor. Everything type-specific — the validation object,
 * the members, the children — is delegated to the field type resolved from the registry.
 */
export const normalizeWorkflowField = (
  field: unknown,
  level: WorkflowFieldLevel,
  registry: WorkflowFieldTypeRegistry = getFieldTypeRegistry(),
): AnyNormalizedField => {
  if (!isPlainObject(field)) {
    failWorkflow('INVALID_VALUE');
  }

  const fieldRecord = field as Record<string, unknown>;
  const typeName = fieldRecord.type;
  if (typeof typeName !== 'string') {
    failWorkflow('INVALID_VALUE');
  }

  const fieldType = getFieldType(typeName as string, registry);
  if (!fieldType.levels.includes(level)) {
    failWorkflow('INVALID_VALUE');
  }

  const includeRequired = includesRequired(level);
  if (includeRequired) {
    if (typeof fieldRecord.required !== 'boolean') {
      failWorkflow('INVALID_VALUE');
    }
  } else if (Object.prototype.hasOwnProperty.call(fieldRecord, 'required')) {
    failWorkflow('INVALID_VALUE');
  }

  const includePersist = includesPersist(level);
  if (Object.prototype.hasOwnProperty.call(fieldRecord, 'persist')) {
    if (!includePersist || typeof fieldRecord.persist !== 'boolean') {
      failWorkflow('INVALID_VALUE');
    }
  }

  if (Object.prototype.hasOwnProperty.call(fieldRecord, 'clientVisible')) {
    if (!includePersist || typeof fieldRecord.clientVisible !== 'boolean') {
      failWorkflow('INVALID_VALUE');
    }
  }

  const validation = fieldRecord.validation;
  if (validation !== undefined && !isPlainObject(validation)) {
    failWorkflow('INVALID_VALUE');
  }

  const validationObject = validation as Record<string, unknown> | undefined;
  if (validationObject !== undefined) {
    fieldType.validateValidation(validationObject, failWorkflow);
  }

  const context: FieldNormalizationContext = {
    level,
    field: fieldRecord,
    validation: validationObject,
    required: includeRequired ? (fieldRecord.required as boolean) : undefined,
    persist: includePersist ? (fieldRecord.persist as boolean | undefined) : undefined,
    clientVisible: includePersist ? (fieldRecord.clientVisible as boolean | undefined) : undefined,
    includeRequired,
    includePersist,
    normalizeChild: (child, childLevel) => normalizeWorkflowField(child, childLevel, registry),
  };

  return fieldType.normalizeField(context, failWorkflow);
};
