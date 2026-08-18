import Ajv, { type AnySchema } from 'ajv';
import addFormats from 'ajv-formats';
import type { AnyNormalizedField, JsonSchemaFragment } from './fields/field-type.port';
import {
  getFieldType,
  getFieldTypeRegistry,
  type WorkflowFieldTypeRegistry,
} from './fields/field-type.registry';
import { listFieldFormats } from './formats/field-format.registry';
import { isPlainObject } from './value-guards';
import type { NormalizedWorkflowStep } from './workflow-contract';

export type StepDataValidator = ((value: unknown) => boolean) & {
  schema: Record<string, unknown>;
};

const registerCustomFormats = (ajv: Ajv): void => {
  for (const format of listFieldFormats()) {
    const validateValue = format.validate;
    if (format.provider !== 'custom' || validateValue === undefined) {
      continue;
    }

    ajv.addFormat(format.name, {
      type: 'string',
      validate: (value: unknown) => typeof value === 'string' && validateValue(value),
    });
  }
};

/**
 * Compiles the JSON Schema a single field's value must satisfy. Exposed so read-side consumers can
 * describe one field without compiling a whole step.
 */
export const buildFieldDataSchema = (
  field: AnyNormalizedField,
  registry: WorkflowFieldTypeRegistry = getFieldTypeRegistry(),
): JsonSchemaFragment => {
  return getFieldType(field.type, registry).buildDataSchema(field, (child) =>
    buildFieldDataSchema(child, registry),
  );
};

/**
 * Compiles the JSON Schema a step's submitted data must satisfy. Each field type contributes its
 * own fragment, so the shape of a new type is defined in one place.
 */
export const createStepDataValidator = (
  step: NormalizedWorkflowStep,
  activeFieldNames?: string[],
  registry: WorkflowFieldTypeRegistry = getFieldTypeRegistry(),
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
        buildFieldDataSchema(field, registry),
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
