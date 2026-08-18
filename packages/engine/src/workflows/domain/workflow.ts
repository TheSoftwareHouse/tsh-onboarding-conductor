import type {
  NormalizedFileField,
  NormalizedWorkflowDefinition,
  NormalizedWorkflowNotifyWebhookDeclaration,
  NormalizedWorkflowTransition,
  WorkflowManualTransitionStatus,
  WorkflowStatus,
  WorkflowTransitionStatus,
} from '@tsh/ddl-schema';
import type {
  ConnectorExecutionPort,
  ConnectorRejectionReason,
} from '../../connectors/ports/connector-execution.port';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../connectors/ports/connector-execution-result';
import { Step, type StepDescription } from './step';
import {
  type WorkflowEvaluationRejectionReason,
  WorkflowEvaluationResult,
} from './workflow-evaluation-result';

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
  continuation?: Readonly<{
    resolvedConnector: Readonly<{
      connectorOrder: number;
      result: ConnectorExecutionResult;
    }>;
  }>;
};

type WorkflowManualTransitionTrigger = WorkflowManualTransitionStatus;

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
  rejectionReason: ConnectorRejectionReason | null;
};

export { WorkflowEvaluationResult } from './workflow-evaluation-result';

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
  ): { fieldName: string; field: NormalizedFileField } | undefined {
    return this.activeStep(currentStep)?.getFileFieldMetadata();
  }

  /** Read-side projection of the step a client must render now, or `undefined` when there is none. */
  findStepDescription(
    currentStep: string | null | undefined,
    onboardingContext?: Readonly<Record<string, unknown>>,
  ): StepDescription | undefined {
    const step = this.activeStep(currentStep);

    if (!step || step.isTerminal) {
      return undefined;
    }

    return step.describe(onboardingContext);
  }

  getRootNotifyWebhook(): NormalizedWorkflowNotifyWebhookDeclaration | undefined {
    return this.definition.webhook?.notify;
  }

  getEffectiveNotifyWebhookForTransition(
    transition: NormalizedWorkflowTransition | undefined,
  ): NormalizedWorkflowNotifyWebhookDeclaration | undefined {
    const rootWebhook = this.getRootNotifyWebhook();
    if (!rootWebhook) {
      return undefined;
    }

    if (!transition) {
      return undefined;
    }

    if (transition.webhook?.notify === false) {
      return undefined;
    }

    return rootWebhook;
  }

  async evaluate(input: WorkflowEvaluationInput): Promise<WorkflowEvaluationResult> {
    const currentStep = this.activeStep(input.currentStep);
    const terminalInvalidState = this.buildTerminalInvalidState(input.onboardingContext);

    if (!currentStep || currentStep.isTerminal) {
      return WorkflowEvaluationResult.terminalInvalid('UNKNOWN_STATE', {
        nextState: terminalInvalidState,
      });
    }

    const stepData = currentStep.collectAcceptedData(input.submittedData, input.onboardingContext);
    if (stepData.acceptedData === null || stepData.connectorData === null) {
      return WorkflowEvaluationResult.retryableInvalidData(stepData.fieldErrors, currentStep.name);
    }

    const transitionContext = {
      ...(input.onboardingContext ?? {}),
      ...(stepData.connectorData ?? {}),
    };

    return this.evaluateTransition(
      currentStep,
      stepData.acceptedData,
      stepData.connectorData,
      'success',
      input.onboardingContext,
      transitionContext,
      input.onboardingId,
      terminalInvalidState,
      input.continuation,
    );
  }

  evaluateManual(
    input: WorkflowManualEvaluationInput,
    trigger: WorkflowManualTransitionTrigger,
  ): WorkflowEvaluationResult {
    if (
      trigger !== 'manual.approve' &&
      trigger !== 'manual.reject' &&
      trigger !== 'manual.invalid'
    ) {
      return WorkflowEvaluationResult.unknownEvaluation();
    }

    const currentStep = this.activeStep(input.currentStep);
    const terminalInvalidState = this.buildTerminalInvalidState({
      ...(input.onboardingContext ?? {}),
    });

    if (!currentStep || currentStep.isTerminal) {
      return WorkflowEvaluationResult.manualTransitionUnavailable({
        appliedStep: currentStep?.name,
      });
    }

    const persistedContext = { ...(input.onboardingContext ?? {}) };

    return this.resolveTarget(
      currentStep,
      {},
      trigger as WorkflowTransitionStatus,
      persistedContext,
      undefined,
      terminalInvalidState,
      'manual',
      persistedContext,
    );
  }

  private activeStep(currentStep: string | null | undefined): Step | undefined {
    return typeof currentStep === 'string' ? this.stepsByName[currentStep] : undefined;
  }

  private async evaluateTransition(
    currentStep: Step,
    acceptedData: Record<string, unknown>,
    connectorData: Record<string, unknown>,
    trigger: WorkflowTransitionStatus,
    onboardingContext: Readonly<Record<string, unknown>>,
    transitionContext: Readonly<Record<string, unknown>>,
    onboardingId: string,
    terminalInvalidState: WorkflowNextState,
    continuation?: Readonly<{
      resolvedConnector: Readonly<{
        connectorOrder: number;
        result: ConnectorExecutionResult;
      }>;
    }>,
  ): Promise<WorkflowEvaluationResult> {
    let resolvedTrigger: WorkflowTransitionStatus = trigger;
    const resolvedAcceptedData: Record<string, unknown> = acceptedData;
    const connectorContext = { ...onboardingContext, ...connectorData };
    const nextContext = { ...onboardingContext, ...acceptedData };
    let rejectionReason: WorkflowEvaluationRejectionReason | undefined;

    if (this.connectorExecutionPort) {
      const outcome = continuation
        ? await this.connectorExecutionPort.resume(
            currentStep.connectors,
            connectorContext,
            {
              onboardingId,
              stepName: currentStep.name,
            },
            continuation.resolvedConnector.connectorOrder,
            continuation.resolvedConnector.result,
          )
        : await this.connectorExecutionPort.execute(currentStep.connectors, connectorContext, {
            onboardingId,
            stepName: currentStep.name,
          });

      if (outcome.isInvalid()) {
        return WorkflowEvaluationResult.terminalInvalid('UNKNOWN_STATE', {
          appliedStep: currentStep.name,
          nextState: terminalInvalidState,
        });
      }

      if (outcome.isInvalidData()) {
        if (this.isRetryableInvalidData(outcome.metadata)) {
          return WorkflowEvaluationResult.retryableInvalidData(
            outcome.errors ?? {},
            currentStep.name,
          );
        }

        return WorkflowEvaluationResult.terminalInvalid('UNKNOWN_STATE', {
          appliedStep: currentStep.name,
          nextState: terminalInvalidState,
        });
      }

      if (outcome.isRejected()) {
        resolvedTrigger = 'rejected';
        rejectionReason = outcome.reason ?? 'CONNECTOR_REJECTED';
      }

      if (outcome.isPending()) {
        return WorkflowEvaluationResult.parkedAsyncCallback(
          resolvedAcceptedData,
          currentStep.name,
          {
            context: nextContext,
            status: currentStep.status,
            currentStep: currentStep.name,
            completedAt: null,
            rejectionReason: null,
          },
          outcome.pending!,
        );
      }
    }

    return this.resolveTarget(
      currentStep,
      resolvedAcceptedData,
      resolvedTrigger,
      nextContext,
      rejectionReason,
      terminalInvalidState,
      'terminal',
      transitionContext,
    );
  }

  private resolveTarget(
    currentStep: Step,
    acceptedData: Record<string, unknown>,
    trigger: WorkflowTransitionStatus,
    context: Record<string, unknown>,
    rejectionReason?: WorkflowEvaluationRejectionReason,
    terminalInvalidState?: WorkflowNextState,
    invalidKind: 'terminal' | 'manual' = 'terminal',
    transitionContext?: Readonly<Record<string, unknown>>,
  ): WorkflowEvaluationResult {
    const transition = currentStep.resolveTransition(trigger, transitionContext);
    if (!transition) {
      if (invalidKind === 'manual') {
        return WorkflowEvaluationResult.manualTransitionUnavailable({
          appliedStep: currentStep.name,
        });
      }

      return WorkflowEvaluationResult.terminalInvalid('UNKNOWN_STATE', {
        appliedStep: currentStep.name,
        nextState: terminalInvalidState as WorkflowNextState,
      });
    }

    const targetName = transition.target ?? null;

    const target = targetName === null ? currentStep : this.stepsByName[targetName];
    if (!target) {
      return WorkflowEvaluationResult.terminalInvalid('UNKNOWN_STATE', {
        appliedStep: currentStep.name,
        nextState: terminalInvalidState as WorkflowNextState,
      });
    }

    const terminal = target.isTerminal;
    const resolvedRejectionReason: ConnectorRejectionReason | null =
      trigger === 'rejected' ? (rejectionReason ?? 'CONNECTOR_REJECTED') : null;

    const nextState: WorkflowNextState = {
      context,
      status: this.targetStatus(target),
      currentStep: terminal ? null : target.name,
      completedAt: terminal ? new Date() : null,
      rejectionReason: resolvedRejectionReason,
    };

    if (trigger === 'rejected') {
      return WorkflowEvaluationResult.rejected(
        acceptedData,
        currentStep.name,
        nextState,
        resolvedRejectionReason ?? 'CONNECTOR_REJECTED',
        transition,
      );
    }

    return WorkflowEvaluationResult.accepted(acceptedData, currentStep.name, nextState, transition);
  }

  private buildTerminalInvalidState(
    onboardingContext: Readonly<Record<string, unknown>>,
  ): WorkflowNextState {
    return {
      context: { ...onboardingContext },
      status: 'invalid',
      currentStep: null,
      completedAt: new Date(),
      rejectionReason: null,
    };
  }

  private targetStatus(step: Step | undefined): WorkflowStatus {
    return step?.status ?? 'awaiting_user';
  }

  private isRetryableInvalidData(metadata: Readonly<Record<string, unknown>> | undefined): boolean {
    return metadata?.[ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA] === true;
  }
}
