import Ajv, { type AnySchema } from 'ajv';
import addFormats from 'ajv-formats';
import type { AnyNormalizedField, JsonSchemaFragment } from './fields/field-type.port';
import {
  FIELD_TYPE_REGISTRY,
  getFieldType,
  type WorkflowFieldTypeRegistry,
} from './fields/field-type.registry';
import { FIELD_FORMAT_DEFINITIONS } from './formats/field-format.registry';
import { isPlainObject } from './value-guards';
import type { NormalizedWorkflowStep } from './workflow-contract';

export type StepDataValidator = ((value: unknown) => boolean) & {
  schema: Record<string, unknown>;
};

const registerCustomFormats = (ajv: Ajv): void => {
  for (const format of FIELD_FORMAT_DEFINITIONS) {
    if (format.provider !== 'custom') {
      continue;
    }

    const validateValue = format.validate;
    ajv.addFormat(format.name, {
      type: 'string',
      validate: (value: unknown) => typeof value === 'string' && validateValue(value),
    });
  }
};

const buildFieldSchema = (
  field: AnyNormalizedField,
  registry: WorkflowFieldTypeRegistry,
): JsonSchemaFragment => {
  return getFieldType(field.type, registry).buildDataSchema(field, (child) =>
    buildFieldSchema(child, registry),
  );
};

/**
 * Compiles the JSON Schema a step's submitted data must satisfy. Each field type contributes its
 * own fragment, so the shape of a new type is defined in one place.
 */
export const createStepDataValidator = (
  step: NormalizedWorkflowStep,
  activeFieldNames?: string[],
  registry: WorkflowFieldTypeRegistry = FIELD_TYPE_REGISTRY,
): StepDataValidator => {
  const activeFields =
    activeFieldNames !== undefined
      ? Object.fromEntries(
          Object.entries(step.data).filter(([fieldName]) => activeFieldNames.includes(fieldName)),
        )
      : step.data;

  const schema: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(
      Object.entries(activeFields).map(([fieldName, field]) => [
        fieldName,
        buildFieldSchema(field, registry),
      ]),
    ),
    required: Object.entries(activeFields)
      .filter(
        ([, field]) =>
          field.required || getFieldType(field.type, registry).alwaysRequiredInStepData === true,
      )
      .map(([fieldName]) => fieldName),
  };

  const ajv = new Ajv({ strict: true, allErrors: false, validateFormats: true });
  addFormats(ajv);
  registerCustomFormats(ajv);

  const validate = ajv.compile(schema as AnySchema);

  const validator = (value: unknown): boolean => {
    if (!isPlainObject(value)) {
      return false;
    }

    const result = validate(value);
    return typeof result === 'boolean' ? result : false;
  };

  validator.schema = schema;

  return validator;
};
