import { InjectionToken, NotFoundException } from '@nestjs/common';
import type { NormalizedWorkflowDefinition } from '@tsh/ddl-schema';

export const ONBOARDING_RUNTIME_PORT = Symbol('ONBOARDING_RUNTIME_PORT') as InjectionToken;
export const WORKFLOW_SOURCE = Symbol('WORKFLOW_SOURCE') as InjectionToken;

export type WorkflowSource = {
  findById(workflowId: string, version?: number): NormalizedWorkflowDefinition | undefined;
};

export type RuntimeWorkflowReference = {
  workflowId: string;
  workflowVersion: number;
};

export type InitializeOnboardingCommand = RuntimeWorkflowReference;

export type EvaluateOnboardingCommand = RuntimeWorkflowReference & {
  currentStep: string | null | undefined;
  submittedData: unknown;
};

export type RuntimeTargetState = {
  status: 'awaiting_user' | 'approved';
  currentStep: string | null;
};

export type RuntimeSuccessResult = {
  success: true;
  workflowId: string;
  workflowVersion: number;
  persistedCurrentStep: string | null | undefined;
  submittedData?: unknown;
  acceptedData: Record<string, unknown>;
  appliedStep: string;
  targetState: RuntimeTargetState;
  terminal: boolean;
};

export type RuntimeInputFailure = {
  success: false;
  code: 'INVALID_STEP_DATA';
  acceptedData: Record<string, never>;
};

export type OnboardingRuntimePort = {
  initialize(command: InitializeOnboardingCommand): RuntimeSuccessResult;
  evaluate(command: EvaluateOnboardingCommand): RuntimeSuccessResult | RuntimeInputFailure;
};

export class RuntimeConfigurationError extends Error {
  readonly code = 'WORKFLOW_INVALID' as const;

  constructor() {
    super('WORKFLOW_INVALID');
    this.name = 'RuntimeConfigurationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WorkflowNotFoundError extends NotFoundException {
  readonly code = 'WORKFLOW_NOT_FOUND' as const;

  constructor() {
    super({ code: 'WORKFLOW_NOT_FOUND', message: 'WORKFLOW_NOT_FOUND' });
    this.name = 'WorkflowNotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
