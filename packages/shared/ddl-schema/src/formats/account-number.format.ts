import type { WorkflowFieldFormatDefinition } from './field-format.port';

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

export const accountNumberFormatDefinition = {
  name: 'account-number',
  provider: 'custom',
  validate: validateAccountNumber,
} as const satisfies WorkflowFieldFormatDefinition;
