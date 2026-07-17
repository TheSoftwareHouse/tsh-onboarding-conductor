import type {
  NormalizedWorkflowDefinition,
  NormalizedWorkflowField,
  NormalizedWorkflowStep,
  WorkflowStatus,
} from '@tsh/ddl-schema';

export type WorkflowInitializationResult = {
  workflowId: string;
  workflowVersion: number;
  status: WorkflowStatus;
  currentStep: string | null;
};

export type WorkflowEvaluationInput = {
  currentStep: string | null | undefined;
  submittedData: unknown;
};

export type WorkflowEvaluationResult = {
  acceptedData: Record<string, unknown>;
  appliedStep: string;
  status: WorkflowStatus;
  currentStep: string | null;
  terminal: boolean;
};

export class Workflow {
  constructor(private readonly definition: NormalizedWorkflowDefinition) {}

  get id(): string {
    return this.definition.id;
  }

  get version(): number {
    return this.definition.version;
  }

  initialize(): WorkflowInitializationResult {
    const initialStep = this.definition.stepsByName[this.definition.initial];

    return {
      workflowId: this.definition.id,
      workflowVersion: this.definition.version,
      status: this.targetStatus(initialStep),
      currentStep: this.isTerminalStep(initialStep) ? null : initialStep.name,
    };
  }

  evaluate(input: WorkflowEvaluationInput): WorkflowEvaluationResult | undefined {
    const currentStep = this.activeStep(input.currentStep);

    if (
      !currentStep ||
      this.isTerminalStep(currentStep) ||
      !this.isSubmittedData(input.submittedData)
    ) {
      return undefined;
    }

    const acceptedData = this.validateAndCollectData(currentStep, input.submittedData);
    if (!acceptedData) {
      return undefined;
    }

    const target = this.resolveSuccessTarget(currentStep);
    if (!target) {
      return undefined;
    }

    return {
      acceptedData,
      appliedStep: currentStep.name,
      status: this.targetStatus(target),
      currentStep: this.isTerminalStep(target) ? null : target.name,
      terminal: this.isTerminalStep(target),
    };
  }

  private activeStep(currentStep: string | null | undefined): NormalizedWorkflowStep | undefined {
    return typeof currentStep === 'string' ? this.definition.stepsByName[currentStep] : undefined;
  }

  private isTerminalStep(step: NormalizedWorkflowStep): boolean {
    return step.terminal;
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

  private resolveSuccessTarget(
    currentStep: NormalizedWorkflowStep,
  ): NormalizedWorkflowStep | undefined {
    const transition = currentStep.transitions.find((candidate) => candidate.status === 'success');
    if (!transition) {
      return undefined;
    }

    return this.definition.stepsByName[transition.target];
  }

  private targetStatus(step: NormalizedWorkflowStep): WorkflowStatus {
    return step.status;
  }
}
