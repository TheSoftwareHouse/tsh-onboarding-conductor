import type { components } from '@tsh/openapi';

type WorkflowStatus = components['schemas']['WorkflowStatus'];
type AgreementStatus = components['schemas']['OnboardingAgreementStatus'];

export const WORKFLOW_STATUSES: readonly WorkflowStatus[] = [
  'awaiting_user',
  'awaiting_manual_review',
  'approved',
  'rejected',
  'invalid',
];
export const AGREEMENT_STATUSES: readonly AgreementStatus[] = [
  'current',
  'outdated',
  'not_accepted',
];

/** The `resourceType` the engine's audit rows about an onboarding carry. */
export const ONBOARDING_RESOURCE_TYPE = 'onboarding';

/** Engine reads a tool may have in flight at once, so one call never floods the engine. */
export const ENGINE_READ_CONCURRENCY = 5;
