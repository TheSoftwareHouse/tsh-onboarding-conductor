import { Inject, Injectable } from '@nestjs/common';
import type {
  NormalizedWorkflowDefinition,
  NormalizedWorkflowField,
  NormalizedWorkflowStep,
} from '@tsh/ddl-schema';
import {
  EvaluateOnboardingCommand,
  InitializeOnboardingCommand,
  OnboardingRuntimePort,
  RuntimeConfigurationError,
  RuntimeInputFailure,
  RuntimeSuccessResult,
  WORKFLOW_SOURCE,
  WorkflowNotFoundError,
  type WorkflowSource,
} from './onboarding-runtime.port';

@Injectable()
export class ConfigurableSynchronousRuntimeAdapter implements OnboardingRuntimePort {
  constructor(
    @Inject(WORKFLOW_SOURCE)
    private readonly workflowSource: WorkflowSource,
  ) {}

  initialize(command: InitializeOnboardingCommand): RuntimeSuccessResult {
    const workflow = this.workflow(command.workflowId, command.workflowVersion, true);
    const initialStep = workflow.stepsByName[workflow.initial];

    return {
      success: true,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      persistedCurrentStep: null,
      acceptedData: {},
      appliedStep: initialStep.name,
      targetState: {
        status: initialStep.status,
        currentStep: initialStep.terminal ? null : initialStep.name,
      },
      terminal: initialStep.terminal,
    };
  }

  evaluate(command: EvaluateOnboardingCommand): RuntimeSuccessResult | RuntimeInputFailure {
    const workflow = this.workflow(command.workflowId, command.workflowVersion, false);
    const currentStep = this.step(workflow, command.currentStep);

    if (!currentStep || currentStep.terminal || !this.isSubmittedData(command.submittedData)) {
      return this.failure();
    }

    const acceptedData = this.validateAndCollectData(currentStep, command.submittedData);
    if (!acceptedData) {
      return this.failure();
    }

    const transition = currentStep.transitions.find((candidate) => candidate.status === 'success');
    const target = transition ? workflow.stepsByName[transition.target] : undefined;
    if (!transition || !target) {
      return this.failure();
    }

    return {
      success: true,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      persistedCurrentStep: command.currentStep,
      submittedData: command.submittedData,
      acceptedData,
      appliedStep: currentStep.name,
      targetState: {
        status: target.status,
        currentStep: target.terminal ? null : target.name,
      },
      terminal: target.terminal,
    };
  }

  private workflow(
    workflowId: string,
    workflowVersion: number,
    notFound: boolean,
  ): NormalizedWorkflowDefinition {
    const workflow = this.workflowSource.findById(workflowId, workflowVersion);
    if (!workflow) {
      throw notFound ? new WorkflowNotFoundError() : new RuntimeConfigurationError();
    }
    return workflow;
  }

  private step(
    workflow: NormalizedWorkflowDefinition,
    currentStep: string | null | undefined,
  ): NormalizedWorkflowStep | undefined {
    return typeof currentStep === 'string' ? workflow.stepsByName[currentStep] : undefined;
  }

  private isSubmittedData(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private validateAndCollectData(
    step: NormalizedWorkflowStep,
    submittedData: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const declaredFields = Object.keys(step.data);
    const submittedFields = Object.keys(submittedData);
    if (
      submittedFields.some((fieldName) => !declaredFields.includes(fieldName)) ||
      submittedFields.length !== declaredFields.length
    ) {
      return null;
    }

    const acceptedData: Record<string, unknown> = {};
    for (const fieldName of declaredFields) {
      const field = step.data[fieldName];
      const value = submittedData[fieldName];
      if (!this.isValidFieldValue(field, value)) {
        return null;
      }
      acceptedData[fieldName] = value;
    }

    return acceptedData;
  }

  private isValidFieldValue(field: NormalizedWorkflowField, value: unknown): boolean {
    if (field.type === 'boolean') {
      return value === true;
    }

    return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  private failure(): RuntimeInputFailure {
    return {
      success: false,
      code: 'INVALID_STEP_DATA',
      acceptedData: {},
    };
  }
}
