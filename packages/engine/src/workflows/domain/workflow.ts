import type {
  NormalizedWorkflowDefinition,
  NormalizedWorkflowField,
  NormalizedWorkflowWebhookDeclaration,
  WorkflowStatus,
} from '@tsh/ddl-schema';
import type { ConnectorExecutionPort } from '../../connectors/ports/connector-execution.port';
import type {
  ConnectorExecutionResult,
  ConnectorRejectionReason,
} from '../../connectors/ports/connector-execution.port';
import { Step } from './step';
import {
  type WorkflowEvaluationRejectionReason,
  WorkflowEvaluationResult,
} from './workflow-evaluation-result';

type WorkflowTransitionStatus =
  'success' | 'rejected' | 'manual.approve' | 'manual.reject' | 'manual.return';

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

  getSourceStepWebhook(
    currentStep: string | null | undefined,
  ): NormalizedWorkflowWebhookDeclaration | undefined {
    return this.activeStep(currentStep)?.webhook;
  }

  async evaluate(input: WorkflowEvaluationInput): Promise<WorkflowEvaluationResult> {
    const currentStep = this.activeStep(input.currentStep);

    if (!currentStep || currentStep.isTerminal) {
      return WorkflowEvaluationResult.invalid('UNKNOWN_STATE');
    }

    const stepData = currentStep.collectAcceptedData(input.submittedData);
    if (!stepData.acceptedData) {
      return WorkflowEvaluationResult.invalidData(stepData.fieldErrors);
    }

    return this.evaluateTransition(
      currentStep,
      stepData.acceptedData,
      'success',
      input.onboardingContext,
      input.onboardingId,
    );
  }

  evaluateManual(
    input: WorkflowManualEvaluationInput,
    trigger: WorkflowTransitionStatus,
  ): WorkflowEvaluationResult {
    if (
      trigger !== 'manual.approve' &&
      trigger !== 'manual.reject' &&
      trigger !== 'manual.return'
    ) {
      return WorkflowEvaluationResult.invalid('UNKNOWN_STATE');
    }

    const currentStep = this.activeStep(input.currentStep);

    if (!currentStep || currentStep.isTerminal) {
      return WorkflowEvaluationResult.invalid('UNKNOWN_STATE');
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
      const normalizedOutcome = this.normalizeConnectorExecutionOutcome(outcome);

      if (normalizedOutcome.status === 'invalid') {
        return WorkflowEvaluationResult.invalid('UNKNOWN_STATE');
      }

      if (normalizedOutcome.status === 'invalid-data') {
        return WorkflowEvaluationResult.invalidData(normalizedOutcome.errors);
      }

      if (normalizedOutcome.status === 'accepted' && verifyCodeSourceFields.size > 0) {
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

      if (normalizedOutcome.status === 'rejected') {
        resolvedTrigger = 'rejected';
        rejectionReason = normalizedOutcome.reason;
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
    );
  }

  private resolveTarget(
    currentStep: Step,
    acceptedData: Record<string, unknown>,
    trigger: WorkflowTransitionStatus,
    context: Record<string, unknown>,
    rejectionReason?: WorkflowEvaluationRejectionReason,
  ): WorkflowEvaluationResult {
    const targetName = currentStep.transitionTargetName(trigger);
    if (targetName === undefined) {
      return WorkflowEvaluationResult.invalid('UNKNOWN_STATE');
    }

    const target = targetName === null ? currentStep : this.stepsByName[targetName];
    if (!target) {
      return WorkflowEvaluationResult.invalid('UNKNOWN_STATE');
    }

    const terminal = target.isTerminal;

    const nextState: WorkflowNextState = {
      context,
      status: this.targetStatus(target),
      currentStep: terminal ? null : target.name,
      completedAt: terminal ? new Date() : null,
    };

    if (trigger === 'rejected') {
      return WorkflowEvaluationResult.rejected(
        acceptedData,
        currentStep.name,
        nextState,
        rejectionReason ?? 'CONNECTOR_REJECTED',
      );
    }

    return WorkflowEvaluationResult.accepted(acceptedData, currentStep.name, nextState);
  }

  private normalizeConnectorExecutionOutcome(
    outcome: ConnectorExecutionResult,
  ):
    | Readonly<{ status: 'accepted' }>
    | Readonly<{ status: 'invalid' }>
    | Readonly<{ status: 'invalid-data'; errors: Readonly<Record<string, readonly string[]>> }>
    | Readonly<{ status: 'rejected'; reason: ConnectorRejectionReason }> {
    if (outcome.isAccepted()) {
      return { status: 'accepted' };
    }

    if (outcome.isInvalid()) {
      return { status: 'invalid' };
    }

    if (outcome.isInvalidData()) {
      return {
        status: 'invalid-data',
        errors: outcome.errors ?? {},
      };
    }

    return {
      status: 'rejected',
      reason: outcome.reason ?? 'CONNECTOR_REJECTED',
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
