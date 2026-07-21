export type OnboardingJourneyStatus = 'awaiting_user' | 'approved';

export type OnboardingJourneyValidationKind = 'email' | 'phone' | 'must-be-true';

export type OnboardingJourneyFieldDescriptor = {
  name: string;
  type: 'string' | 'boolean';
  required: boolean;
  persist: boolean;
  validation: {
    kind: OnboardingJourneyValidationKind;
  };
};

export type OnboardingActiveStepDescriptor = {
  stepId: string;
  fields: readonly OnboardingJourneyFieldDescriptor[];
};

export type OnboardingJourneyStateDescriptor = {
  onboardingId: string;
  status: OnboardingJourneyStatus;
  currentStep: OnboardingActiveStepDescriptor | null;
};

export type OnboardingProblemFieldError = {
  field: string;
  code: string;
};

export type OnboardingProblemDocument = {
  type: string;
  title: string;
  status: 400;
  code: 'INVALID_STEP_DATA';
  fieldErrors: readonly OnboardingProblemFieldError[];
};

export type OnboardingSafeHistoryItem = {
  event: 'validation_rejected' | 'transitioned';
  appliedStep: string;
  resultingStatus: OnboardingJourneyStatus;
  resultingCurrentStep: string | null;
  timestamp: string;
  fieldErrors?: readonly OnboardingProblemFieldError[];
};
