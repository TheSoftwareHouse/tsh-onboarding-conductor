export const sharedPackageName = '@tsh/shared';

export { ONBOARDING_STATUSES, type OnboardingStatus } from './status';
export type { OnboardingStateDescriptor } from './state';
export { TRIVIAL_WORKFLOW_FIXTURE, type TrivialWorkflowFixture } from './workflow-fixture';
export { ONBOARDING_ENDPOINTS } from './endpoints';
export type {
  CreateOnboardingRequest,
  CreateOnboardingResponse,
  GetOnboardingResponse,
  GetOnboardingStateResponse,
  SubmitOnboardingRequest,
  SubmitOnboardingResponse,
} from './onboarding-contract';
