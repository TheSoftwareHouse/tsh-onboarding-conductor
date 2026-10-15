/** Operator-facing label per authored step type, keyed by the ddl-schema step-type names. */
export const STEP_KIND_LABELS: Record<string, string> = {
  address: 'Address',
  'connector-call': 'Connector call',
  consents: 'Consents',
  'contact-details': 'Contact details',
  'credit-assessment': 'Credit check',
  custom: 'Custom',
  decision: 'Branch',
  'document-capture': 'Document upload',
  'document-choice': 'Document choice',
  form: 'Collect data',
  'http-call': 'HTTP call',
  'identity-profile': 'Identity profile',
  'kyc-identity-verification': 'Identity check',
  'manual-review': 'Manual review',
  notify: 'Notification',
  'otp-verify': 'Code verification',
  questionnaire: 'Questionnaire',
  'risk-score': 'Risk score',
  'selfie-capture': 'Selfie capture',
  terminal: 'Terminal',
  'wait-for-external': 'Wait for external',
};

/** The label for a step type, or the raw type when it is not one the panel knows. */
export function describeStepKind(type: string): string {
  return Object.hasOwn(STEP_KIND_LABELS, type) ? STEP_KIND_LABELS[type] : type;
}
