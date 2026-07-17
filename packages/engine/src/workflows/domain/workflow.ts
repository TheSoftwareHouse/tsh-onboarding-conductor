import type { NormalizedWorkflowDefinition, WorkflowStatus } from '@tsh/ddl-schema';
import { Step } from './step';

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
  private readonly stepsByName: Readonly<Record<string, Step>>;

  constructor(private readonly definition: NormalizedWorkflowDefinition) {
    this.stepsByName = Object.fromEntries(
      Object.values(this.definition.stepsByName).map((step) => [step.name, new Step(step)]),
    );
  }

  get id(): string {
    return this.definition.id;
  }

  get version(): number {
    return this.definition.version;
  }

  initialize(): WorkflowInitializationResult {
    const initialStep = this.stepsByName[this.definition.initial];

    return {
      workflowId: this.definition.id,
      workflowVersion: this.definition.version,
      status: this.targetStatus(initialStep),
      currentStep: initialStep?.isTerminal ? null : (initialStep?.name ?? null),
    };
  }

  evaluate(input: WorkflowEvaluationInput): WorkflowEvaluationResult | undefined {
    const currentStep = this.activeStep(input.currentStep);

    if (!currentStep || currentStep.isTerminal) {
      return undefined;
    }

    const acceptedData = currentStep.collectAcceptedData(input.submittedData);
    if (!acceptedData) {
      return undefined;
    }

    const targetName = currentStep.successTransitionTargetName();
    if (!targetName) {
      return undefined;
    }

    const target = this.stepsByName[targetName];
    if (!target) {
      return undefined;
    }

    return {
      acceptedData,
      appliedStep: currentStep.name,
      status: this.targetStatus(target),
      currentStep: target.isTerminal ? null : target.name,
      terminal: target.isTerminal,
    };
  }

  private activeStep(currentStep: string | null | undefined): Step | undefined {
    return typeof currentStep === 'string' ? this.stepsByName[currentStep] : undefined;
  }

  private targetStatus(step: Step | undefined): WorkflowStatus {
    return step?.status ?? 'awaiting_user';
  }
}
