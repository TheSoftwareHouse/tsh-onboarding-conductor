import Ajv, { type AnySchema } from 'ajv';
import addFormats from 'ajv-formats';
import type {
  NormalizedWorkflowArrayItemField,
  NormalizedWorkflowField,
  NormalizedWorkflowNestedField,
  NormalizedWorkflowStep,
  NormalizedTextField,
  NormalizedNumberField,
  NormalizedBooleanField,
  NormalizedDateField,
  TextValidation,
  NumberValidation,
  BooleanValidation,
  DateValidation,
} from './workflow-contract';

export type StepDataValidator = ((value: unknown) => boolean) & {
  schema: Record<string, unknown>;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const luhnCheck = (digits: string): boolean => {
  let sum = 0;
  let shouldDouble = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
};

const validateCreditCard = (value: string): boolean => {
  const normalizedDigits = value.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(normalizedDigits)) {
    return false;
  }
  if (normalizedDigits.length < 13 || normalizedDigits.length > 19) {
    return false;
  }

  return luhnCheck(normalizedDigits);
};

const validateAccountNumber = (value: string): boolean => {
  const normalizedValue = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{15,34}$/.test(normalizedValue)) {
    return false;
  }

  const rearranged = `${normalizedValue.slice(4)}${normalizedValue.slice(0, 4)}`;
  const numericValue = rearranged.replace(/[A-Z]/g, (character) => {
    return String(character.charCodeAt(0) - 55);
  });

  return BigInt(numericValue) % 97n === 1n;
};

const phonePattern = /^\+[1-9]\d{1,14}$/;

const buildFieldSchema = (
  field: NormalizedWorkflowField | NormalizedWorkflowNestedField | NormalizedWorkflowArrayItemField,
): Record<string, unknown> => {
  if (field.type === 'file') {
    return {
      type: 'string',
      minLength: 1,
    };
  }

  if (field.type === 'text') {
    const textField = field as NormalizedTextField;
    const validation = textField.validation as TextValidation | undefined;

    if (validation?.manyOf) {
      return {
        type: 'array',
        minItems: 1,
        uniqueItems: true,
        items: {
          type: 'string',
          enum: [...validation.manyOf],
        },
      };
    }

    const schema: Record<string, unknown> = {
      type: 'string',
    };

    if (validation?.minLength !== undefined) {
      schema.minLength = validation.minLength;
    }
    if (validation?.maxLength !== undefined) {
      schema.maxLength = validation.maxLength;
    }
    if (validation?.pattern !== undefined) {
      schema.pattern = validation.pattern;
    }
    if (validation?.format !== undefined) {
      schema.format = validation.format;
    }
    if (validation?.oneOf) {
      schema.enum = [...validation.oneOf];
    }

    return schema;
  }

  if (field.type === 'number') {
    const numberField = field as NormalizedNumberField;
    const validation = numberField.validation as NumberValidation | undefined;

    if (validation?.manyOf) {
      return {
        type: 'array',
        minItems: 1,
        uniqueItems: true,
        items: {
          type: 'number',
          enum: [...validation.manyOf],
        },
      };
    }

    const schema: Record<string, unknown> = {
      type: 'number',
    };

    if (validation?.minimum !== undefined) {
      schema.minimum = validation.minimum;
    }
    if (validation?.maximum !== undefined) {
      schema.maximum = validation.maximum;
    }
    if (validation?.exclusiveMinimum !== undefined) {
      schema.exclusiveMinimum = validation.exclusiveMinimum;
    }
    if (validation?.exclusiveMaximum !== undefined) {
      schema.exclusiveMaximum = validation.exclusiveMaximum;
    }
    if (validation?.oneOf) {
      schema.enum = [...validation.oneOf];
    }

    return schema;
  }

  if (field.type === 'boolean') {
    const booleanField = field as NormalizedBooleanField;
    const validation = booleanField.validation as BooleanValidation | undefined;

    const schema: Record<string, unknown> = {
      type: 'boolean',
    };

    if (validation?.oneOf) {
      schema.enum = [...validation.oneOf];
    }

    return schema;
  }

  if (field.type === 'object') {
    const properties = Object.fromEntries(
      Object.entries(field.fields).map(([fieldName, nestedField]) => [
        fieldName,
        buildFieldSchema(nestedField),
      ]),
    );

    const required = Object.entries(field.fields)
      .filter(([, nestedField]) => nestedField.required)
      .map(([fieldName]) => fieldName);

    return {
      type: 'object',
      additionalProperties: false,
      properties,
      required,
    };
  }

  if (field.type === 'array') {
    const arraySchema: Record<string, unknown> = {
      type: 'array',
      items: buildFieldSchema(field.items),
    };

    if (field.validation?.minItems !== undefined) {
      arraySchema.minItems = field.validation.minItems;
    }
    if (field.validation?.maxItems !== undefined) {
      arraySchema.maxItems = field.validation.maxItems;
    }

    return arraySchema;
  }

  const dateField = field as NormalizedDateField;
  const validation = dateField.validation as DateValidation | undefined;

  const schema: Record<string, unknown> = {
    type: 'string',
    format: 'date',
  };

  if (validation?.oneOf) {
    schema.enum = [...validation.oneOf];
  }
  if (validation?.manyOf) {
    return {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: {
        type: 'string',
        format: 'date',
        enum: [...validation.manyOf],
      },
    };
  }

  return schema;
};

export const createStepDataValidator = (step: NormalizedWorkflowStep): StepDataValidator => {
  const properties = Object.fromEntries(
    Object.entries(step.data).map(([fieldName, field]) => [fieldName, buildFieldSchema(field)]),
  );

  const required = Object.entries(step.data)
    .filter(([, field]) => field.required || field.type === 'file')
    .map(([fieldName]) => fieldName);

  const schema: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  };

  const ajv = new Ajv({ strict: true, allErrors: false, validateFormats: true });
  addFormats(ajv);
  ajv.addFormat('credit-card', {
    type: 'string',
    validate: (value: unknown) => typeof value === 'string' && validateCreditCard(value),
  });
  ajv.addFormat('account-number', {
    type: 'string',
    validate: (value: unknown) => typeof value === 'string' && validateAccountNumber(value),
  });
  ajv.addFormat('phone', {
    type: 'string',
    validate: (value: unknown) => typeof value === 'string' && phonePattern.test(value),
  });

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
