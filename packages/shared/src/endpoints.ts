export const ONBOARDING_ENDPOINTS = {
  createOnboarding: 'POST /v1/onboardings',
  getOnboarding: 'GET /v1/onboardings/:id',
  getOnboardingState: 'GET /v1/onboardings/:id/state',
  submitOnboarding: 'POST /v1/onboardings/:id/submit',
} as const;
