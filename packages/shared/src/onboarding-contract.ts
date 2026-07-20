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

export type OnboardingStepDescriptor = {
  id: string;
  label: string;
  userVisible: boolean;
};

export type OnboardingStateDescriptor = {
  onboardingId: string;
  workflowId: string;
  workflowVersion: number;
  status: OnboardingStatus;
  currentStep: OnboardingStepDescriptor | null;
};

export const ONBOARDING_ROUTE_METHOD_PATH_PAIRS = [
  { method: 'POST', path: '/v1/onboardings' },
  { method: 'GET', path: '/v1/onboardings/:id' },
  { method: 'GET', path: '/v1/onboardings/:id/state' },
  { method: 'POST', path: '/v1/onboardings/:id/submit' },
] as const;

export type OnboardingRouteMethodPathPair = (typeof ONBOARDING_ROUTE_METHOD_PATH_PAIRS)[number];

export const ONBOARDING_ROUTE_METADATA = {
  create: {
    method: 'POST',
    path: '/v1/onboardings',
    request: {
      workflowId: 'string',
      workflowVersion: 'number',
    },
    response: {
      onboardingId: 'string',
      status: 'OnboardingStatus',
      currentStep: 'OnboardingStepDescriptor|null',
    },
  },
  get: {
    method: 'GET',
    path: '/v1/onboardings/:id',
    request: {},
    response: {
      onboardingId: 'string',
      status: 'OnboardingStatus',
      currentStep: 'OnboardingStepDescriptor|null',
    },
  },
  getState: {
    method: 'GET',
    path: '/v1/onboardings/:id/state',
    request: {},
    response: {
      onboardingId: 'string',
      workflowId: 'string',
      workflowVersion: 'number',
      status: 'OnboardingStatus',
      currentStep: 'OnboardingStepDescriptor|null',
    },
  },
  submit: {
    method: 'POST',
    path: '/v1/onboardings/:id/submit',
    request: {},
    response: {
      onboardingId: 'string',
      status: 'OnboardingStatus',
      currentStep: 'OnboardingStepDescriptor|null',
    },
  },
} as const;

export const e2A1OptionalFieldsRequirement =
  'E2-A1 must support optional fields in the workflow schema and adapter layer.';
export const e2A1PersistFalseRequirement =
  'E2-A1 must support field definitions with persist:false in the workflow schema and adapter layer.';
export const e2A1TerminalTransitionsRequirement =
  'E2-A1 must treat terminal steps as terminal when transitions: [] is declared.';
