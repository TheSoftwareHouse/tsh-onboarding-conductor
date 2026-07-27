import type {
  NormalizedWorkflowDefinition,
  NormalizedWorkflowField,
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
import { Step } from './step';
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
  ): { fieldName: string; field: NormalizedWorkflowField } | undefined {
    return this.activeStep(currentStep)?.getFileFieldMetadata();
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

    const stepData = currentStep.collectAcceptedData(input.submittedData);
    if (stepData.acceptedData === null) {
      return WorkflowEvaluationResult.terminalInvalid('UNKNOWN_STATE', {
        appliedStep: currentStep.name,
        nextState: terminalInvalidState,
      });
    }

    return this.evaluateTransition(
      currentStep,
      stepData.acceptedData,
      'success',
      input.onboardingContext,
      input.onboardingId,
      terminalInvalidState,
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

    return this.resolveTarget(
      currentStep,
      {},
      trigger as WorkflowTransitionStatus,
      { ...(input.onboardingContext ?? {}) },
      undefined,
      terminalInvalidState,
      'manual',
    );
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
    terminalInvalidState: WorkflowNextState,
  ): Promise<WorkflowEvaluationResult> {
    let resolvedTrigger: WorkflowTransitionStatus = trigger;
    let resolvedAcceptedData: Record<string, unknown> = acceptedData;
    let context = { ...onboardingContext, ...acceptedData };
    let rejectionReason: WorkflowEvaluationRejectionReason | undefined;
    const verifyCodeSourceFields = this.verifyCodeSourceFields(currentStep);

    if (this.connectorExecutionPort) {
      const outcome = await this.connectorExecutionPort.execute(currentStep.connectors, context, {
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
        if (currentStep.hasVerifyCodeConnector()) {
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

      if (outcome.isAccepted() && verifyCodeSourceFields.size > 0) {
        resolvedAcceptedData = this.scrubMappedSourceFields(
          resolvedAcceptedData,
          verifyCodeSourceFields,
        );
        context = this.buildContextWithoutMappedSourceFields(
          onboardingContext,
          resolvedAcceptedData,
          verifyCodeSourceFields,
        );
      }

      if (outcome.isRejected()) {
        resolvedTrigger = 'rejected';
        rejectionReason = outcome.reason ?? 'CONNECTOR_REJECTED';
        if (verifyCodeSourceFields.size > 0) {
          resolvedAcceptedData = this.scrubMappedSourceFields(
            resolvedAcceptedData,
            verifyCodeSourceFields,
          );
          context = this.buildContextWithoutMappedSourceFields(
            onboardingContext,
            resolvedAcceptedData,
            verifyCodeSourceFields,
          );
        } else {
          resolvedAcceptedData = {};
        }
      }
    }

    return this.resolveTarget(
      currentStep,
      resolvedAcceptedData,
      resolvedTrigger,
      context,
      rejectionReason,
      terminalInvalidState,
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
  ): WorkflowEvaluationResult {
    const transition = currentStep.resolveTransition(trigger);
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

  private verifyCodeSourceFields(step: Step): ReadonlySet<string> {
    const fields = new Set<string>();

    for (const connector of step.connectors) {
      if (connector.method !== 'verifyCode') {
        continue;
      }

      for (const sourceField of Object.values(connector.fieldMapping)) {
        fields.add(sourceField);
      }
    }

    return fields;
  }

  private scrubMappedSourceFields(
    data: Readonly<Record<string, unknown>>,
    mappedSourceFields: ReadonlySet<string>,
  ): Record<string, unknown> {
    const scrubbedData: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      if (mappedSourceFields.has(key)) {
        continue;
      }

      scrubbedData[key] = value;
    }

    return scrubbedData;
  }

  private buildContextWithoutMappedSourceFields(
    onboardingContext: Readonly<Record<string, unknown>>,
    acceptedData: Readonly<Record<string, unknown>>,
    mappedSourceFields: ReadonlySet<string>,
  ): Record<string, unknown> {
    const mergedContext = { ...onboardingContext, ...acceptedData };

    for (const fieldName of mappedSourceFields) {
      delete mergedContext[fieldName];
    }

    return mergedContext;
  }
}
