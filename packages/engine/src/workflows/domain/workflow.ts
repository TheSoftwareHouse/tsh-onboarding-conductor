import type {
  NormalizedWorkflowDefinition,
  NormalizedWorkflowField,
  NormalizedWorkflowWebhookDeclaration,
  WorkflowStatus,
} from '@tsh/ddl-schema';
import type { ConnectorExecutionPort } from '../../connectors/ports/connector-execution.port';
import { Step } from './step';

type WorkflowTransitionStatus = 'success' | 'manual.approve' | 'manual.reject' | 'manual.return';

export type WorkflowInitializationResult = {
  workflowId: string;
  workflowVersion: number;
  status: WorkflowStatus;
  currentStep: string | null;
};

export type WorkflowEvaluationInput = {
  currentStep: string | null | undefined;
  submittedData: unknown;
  onboardingContext: Readonly<Record<string, unknown>>;
  onboardingId: string;
};

export type WorkflowManualEvaluationInput = {
  currentStep: string | null | undefined;
  submittedData?: unknown;
  onboardingContext?: Readonly<Record<string, unknown>>;
};

export type WorkflowNextState = {
  context: Record<string, unknown>;
  status: WorkflowStatus;
  currentStep: string | null;
  completedAt: Date | null;
};

export type WorkflowEvaluationResult = {
  acceptedData: Record<string, unknown>;
  appliedStep: string;
  sourceStepWebhook?: NormalizedWorkflowWebhookDeclaration;
  nextState: WorkflowNextState;
};

export class Workflow {
  private readonly stepsByName: Readonly<Record<string, Step>>;

  constructor(
    private readonly definition: NormalizedWorkflowDefinition,
    readonly connectorExecutionPort?: ConnectorExecutionPort,
  ) {
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

  getActiveFileFieldMetadata(
    currentStep: string | null | undefined,
  ): { fieldName: string; field: NormalizedWorkflowField } | undefined {
    return this.activeStep(currentStep)?.getFileFieldMetadata();
  }

  getStartWebhook(): NormalizedWorkflowWebhookDeclaration | undefined {
    return this.definition.webhook;
  }

  getSourceStepWebhook(
    currentStep: string | null | undefined,
  ): NormalizedWorkflowWebhookDeclaration | undefined {
    return this.activeStep(currentStep)?.webhook;
  }

  async evaluate(input: WorkflowEvaluationInput): Promise<WorkflowEvaluationResult | undefined> {
    const currentStep = this.activeStep(input.currentStep);

    if (!currentStep || currentStep.isTerminal) {
      return undefined;
    }

    const acceptedData = currentStep.collectAcceptedData(input.submittedData);
    if (!acceptedData) {
      return undefined;
    }

    return this.evaluateTransition(
      currentStep,
      acceptedData,
      'success',
      input.onboardingContext,
      input.onboardingId,
    );
  }

  evaluateManual(
    input: WorkflowManualEvaluationInput,
    trigger: WorkflowTransitionStatus,
  ): WorkflowEvaluationResult | undefined {
    if (
      trigger !== 'manual.approve' &&
      trigger !== 'manual.reject' &&
      trigger !== 'manual.return'
    ) {
      return undefined;
    }

    const currentStep = this.activeStep(input.currentStep);

    if (!currentStep || currentStep.isTerminal) {
      return undefined;
    }

    return this.resolveTarget(currentStep, {}, trigger, { ...(input.onboardingContext ?? {}) });
  }

  private activeStep(currentStep: string | null | undefined): Step | undefined {
    return typeof currentStep === 'string' ? this.stepsByName[currentStep] : undefined;
  }

  private async evaluateTransition(
    currentStep: Step,
    acceptedData: Record<string, unknown>,
    trigger: WorkflowTransitionStatus,
    onboardingContext: Readonly<Record<string, unknown>>,
    onboardingId: string,
  ): Promise<WorkflowEvaluationResult | undefined> {
    const context = { ...onboardingContext, ...acceptedData };

    if (this.connectorExecutionPort) {
      const accepted = await this.connectorExecutionPort.execute(currentStep.connectors, context, {
        onboardingId,
        stepName: currentStep.name,
      });

      if (!accepted) {
        return undefined;
      }
    }

    return this.resolveTarget(currentStep, acceptedData, trigger, context);
  }

  private resolveTarget(
    currentStep: Step,
    acceptedData: Record<string, unknown>,
    trigger: WorkflowTransitionStatus,
    context: Record<string, unknown>,
  ): WorkflowEvaluationResult | undefined {
    const targetName = currentStep.transitionTargetName(trigger);
    if (targetName === undefined) {
      return undefined;
    }

    const target = targetName === null ? currentStep : this.stepsByName[targetName];
    if (!target) {
      return undefined;
    }

    const terminal = target.isTerminal;

    return {
      acceptedData,
      appliedStep: currentStep.name,
      sourceStepWebhook: currentStep.webhook,
      nextState: {
        context,
        status: this.targetStatus(target),
        currentStep: terminal ? null : target.name,
        completedAt: terminal ? new Date() : null,
      },
    };
  }

  private targetStatus(step: Step | undefined): WorkflowStatus {
    return step?.status ?? 'awaiting_user';
  }
}
