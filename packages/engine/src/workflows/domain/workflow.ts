import type {
  NormalizedWorkflowDefinition,
  NormalizedWorkflowField,
  WorkflowStatus,
} from '@tsh/ddl-schema';
import type { ConnectorExecutionPort } from '../../connectors/ports/connector-execution.port';
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
  onboardingContext: Readonly<Record<string, unknown>>;
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

  async evaluate(input: WorkflowEvaluationInput): Promise<WorkflowEvaluationResult | undefined> {
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

    const context = { ...input.onboardingContext, ...acceptedData };

    if (this.connectorExecutionPort) {
      await this.connectorExecutionPort.execute(currentStep.connectors, context);
    }

    const target = this.stepsByName[targetName];
    if (!target) {
      return undefined;
    }

    const terminal = target.isTerminal;

    return {
      acceptedData,
      appliedStep: currentStep.name,
      nextState: {
        context,
        status: this.targetStatus(target),
        currentStep: terminal ? null : target.name,
        completedAt: terminal ? new Date() : null,
      },
    };
  }

  private activeStep(currentStep: string | null | undefined): Step | undefined {
    return typeof currentStep === 'string' ? this.stepsByName[currentStep] : undefined;
  }

  private targetStatus(step: Step | undefined): WorkflowStatus {
    return step?.status ?? 'awaiting_user';
  }
}
