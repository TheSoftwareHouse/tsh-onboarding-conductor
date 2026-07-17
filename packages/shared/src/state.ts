import type { OnboardingStatus } from './status';

export type OnboardingStateDescriptor = {
  onboardingId: string;
  status: OnboardingStatus;
  currentStep: string;
  terminal: boolean;
  expiresAt?: string;
};
