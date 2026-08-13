import type { WorkflowFieldFormatDefinition } from './field-format.port';

const phonePattern = /^\+[1-9]\d{1,14}$/;

const validatePhone = (value: string): boolean => phonePattern.test(value);

export const phoneFormatDefinition = {
  name: 'phone',
  provider: 'custom',
  validate: validatePhone,
} as const satisfies WorkflowFieldFormatDefinition;
