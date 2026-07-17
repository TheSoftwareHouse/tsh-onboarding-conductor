export const ONBOARDING_STATUSES = [
  'created',
  'in_progress',
  'awaiting_user',
  'awaiting_provider_callback',
  'awaiting_account_provisioning',
  'awaiting_user_id',
  'awaiting_webhook_ack',
  'awaiting_manual_review',
  'retry_required',
  'approved',
  'rejected',
  'expired',
  'abandoned',
] as const;

export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];
