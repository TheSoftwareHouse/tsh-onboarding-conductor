import type { OnboardingStateDescriptor } from './state';
import type { OnboardingStatus } from './status';

export type CreateOnboardingRequest = {
  workflowId: string;
  workflowVersion?: number;
  externalReference?: string;
  userId?: string;
  subjectExternalIds?: readonly string[];
  context?: Readonly<Record<string, unknown>>;
};

export type OnboardingResponseShape = {
  onboardingId: string;
  status: OnboardingStatus;
  currentStep: string;
  expiresAt?: string;
};

export type CreateOnboardingResponse = OnboardingResponseShape;
export type GetOnboardingResponse = OnboardingResponseShape;
export type GetOnboardingStateResponse = OnboardingStateDescriptor;
export type SubmitOnboardingRequest = Record<string, never>;
export type SubmitOnboardingResponse = OnboardingResponseShape;
