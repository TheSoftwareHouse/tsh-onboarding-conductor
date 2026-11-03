/**
 * What the seeder knows about `workflows/fixtures/analyst-investigation.workflow.json`: its id, the
 * compiled step names, the provider that parks and the values each question accepts. A change to
 * the workflow is a change here.
 */
export const WORKFLOW_ID = 'analyst-investigation';

export const STEPS = {
  collectProfile: 'collect_profile',
  sendEmailCode: 'send_email_code',
  verifyEmailCode: 'verify_email_code',
  uploadIdentityDocument: 'upload_identity_document',
  checkIdentity: 'check_identity',
  reviewIdentity: 'review_identity',
} as const;

export type WorkflowStepName = (typeof STEPS)[keyof typeof STEPS];

/** The adapter id `check_identity` binds, which is also the callback route's provider key. */
export const IDENTITY_PROVIDER_KEY = 'mock_async_callback_2';

export const IDENTITY_DOCUMENT_FIELD = 'identityDocument';
export const IDENTITY_DOCUMENT_CONTENT_TYPE = 'image/png';

export const REJECTION_REASONS = {
  connectorRejected: 'CONNECTOR_REJECTED',
  attemptsExhausted: 'ATTEMPTS_EXHAUSTED',
} as const;

/** Wrong verification attempts after which `smtp_email_otp` rejects the onboarding. */
export const OTP_MAX_ATTEMPTS = 5;
export const WRONG_VERIFICATION_CODE = '000000';

export const COUNTRIES = [
  'PL',
  'DE',
  'FR',
  'ES',
  'IT',
  'NL',
  'IE',
  'SE',
  'GB',
  'TR',
  'AE',
  'RU',
  'IR',
] as const;

export const HIGH_RISK_COUNTRIES = ['RU', 'IR', 'TR', 'AE'] as const;
export const LOW_RISK_COUNTRIES = COUNTRIES.filter(
  (country) => !(HIGH_RISK_COUNTRIES as readonly string[]).includes(country),
);

export const RISKY_SOURCES_OF_FUNDS = ['sale_of_asset', 'other'] as const;
export const SAFE_SOURCES_OF_FUNDS = [
  'salary',
  'savings',
  'pension',
  'benefits',
  'investments',
  'family_support',
] as const;

export const ACCOUNT_PURPOSES = [
  'salary',
  'personal_spending',
  'savings',
  'marketplace_payouts',
  'travel',
  'remittance',
  'other',
] as const;

export const EMPLOYMENT_STATUSES = [
  'employed',
  'self_employed',
  'student',
  'retired',
  'unemployed',
  'other',
] as const;

export const OCCUPATION_GROUPS = [
  'isco_1',
  'isco_2',
  'isco_3',
  'isco_4',
  'isco_5',
  'isco_6',
  'isco_7',
  'isco_8',
  'isco_9',
  'isco_0',
  'not_in_workforce',
  'other',
] as const;

export const MONTHLY_BANDS = ['lt_1k', '1k_5k', '5k_15k', '15k_50k', 'gt_50k'] as const;

export const MIN_APPLICANT_AGE_YEARS = 18;
export const MAX_APPLICANT_AGE_YEARS = 75;
