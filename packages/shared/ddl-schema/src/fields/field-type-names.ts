/** The built-in field-type names, runtime-free so the browser bundle can read them. */
export const FIELD_TYPE = {
  text: 'text',
  number: 'number',
  boolean: 'boolean',
  date: 'date',
  file: 'file',
  object: 'object',
  array: 'array',
} as const;
