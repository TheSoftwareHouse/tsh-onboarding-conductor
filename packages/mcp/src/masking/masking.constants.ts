/** What happens to a value before it leaves the MCP. Anything not classified is `drop`. */
export const FieldClass = {
  PASS: 'pass',
  PSEUDONYMISE: 'pseudonymise',
  GENERALISE: 'generalise',
  DROP: 'drop',
} as const;

export type FieldClass = (typeof FieldClass)[keyof typeof FieldClass];

/** The formats a pseudonym can stand for; the format is the pseudonym's prefix. */
export const PseudonymFormat = {
  EMAIL: 'email',
  PHONE: 'phone',
} as const;

export type PseudonymFormat = (typeof PseudonymFormat)[keyof typeof PseudonymFormat];

/** The `type` and `validation.format` values the compiled workflow document uses. */
export const DescriptorType = {
  TEXT: 'text',
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  DATE: 'date',
  FILE: 'file',
  OBJECT: 'object',
  ARRAY: 'array',
} as const;

export const PSEUDONYM_HEX_LENGTH = 12;
export const AGE_BAND_YEARS = 10;
export const MAX_PLAUSIBLE_AGE_YEARS = 150;

/**
 * Provider-verdict fields the engine writes itself — reason codes and an attempt counter carry no
 * applicant text — that no declaration marks as enumerated. Added to `MCP_MASKING_PASS_FIELDS`.
 */
export const BUILT_IN_PASS_FIELDS: readonly string[] = ['kycReasonCodes', 'kycAttemptCount'];

/** A date declared under one of these names is a date of birth even without an age bound. */
export const DATE_OF_BIRTH_NAME_PATTERN = /birth|^dob$/i;

/** The columns the engine's CSV export always writes first, by field name. */
export const CSV_SYSTEM_COLUMNS: readonly string[] = [
  'onboardingId',
  'workflowId',
  'workflowVersion',
  'status',
  'currentStep',
  'agreementStatus',
  'rejectionReason',
  'createdAt',
  'updatedAt',
  'completedAt',
];

export const CSV_OTHER_DATA_COLUMN = 'otherData';
export const CSV_SCORE_HEADER_SUFFIX = ' score';
