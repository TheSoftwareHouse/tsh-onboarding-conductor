import { evaluateCondition, SCORE_CONDITION_VARIABLE } from '@tsh/ddl-schema';
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
import type { WorkflowDefinitionResponse } from '../dto/workflow-definition.response.dto';
import {
  type WorkflowEvaluationRejectionReason,
  WorkflowEvaluationResult,
} from './workflow-evaluation-result';

/**
 * What each applied step currently contributes to the onboarding's score, by step name.
 *
 * Stored per step rather than as one running total because workflows loop: the built-in EU KYC
 * document routes a stale phone challenge back to `resend_phone_code` and a poor document back to
 * `capture_selfie`. A total that simply added on every application would pay the applicant who
 * retried most, so a step re-entered replaces its own earlier contribution instead.
 */
export type OnboardingScoreByStep = Readonly<Record<string, number>>;

/** The onboarding's score is the sum of what its applied steps currently contribute. */
export const sumScore = (scoreByStep: OnboardingScoreByStep): number =>
  Object.values(scoreByStep).reduce((total, contribution) => total + contribution, 0);

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
  /** Omitted means nothing has scored yet, which is what a fresh onboarding reports. */
  scoreByStep?: OnboardingScoreByStep;
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
  /** Omitted means nothing has scored yet, which is what a fresh onboarding reports. */
  scoreByStep?: OnboardingScoreByStep;
};

/**
 * One state change as the audit trail recorded it, which is all the trail can say on its own: a
 * terminal move clears `toStep`, so the step actually entered has to be named from the workflow.
 */
export type WorkflowRecordedMove = {
  status: string;
  fromStep: string | null;
  appliedStep: string | null;
  toStep: string | null;
};

export type WorkflowNextState = {
  context: Record<string, unknown>;
  status: WorkflowStatus;
  currentStep: string | null;
  completedAt: Date | null;
  rejectionReason: ConnectorRejectionReason | null;
  /** The sum of `scoreByStep`, denormalized so the admin list can sort and filter on it. */
  score: number;
  scoreByStep: OnboardingScoreByStep;
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

  /**
   * Read-side projection of the whole workflow: every declared step and the transitions between
   * them, which is what a reader needs to draw the shape an onboarding moves through.
   */
  describeDefinition(): WorkflowDefinitionResponse {
    return {
      workflowId: this.definition.id,
      workflowVersion: this.definition.version,
      name: this.definition.name,
      initialStep: this.definition.initial,
      steps: this.definition.steps.map((step) => ({
        name: step.name,
        status: step.status,
        terminal: step.terminal,
        transitions: step.transitions.map((transition) => ({
          status: transition.status,
          target: transition.target ?? null,
          when: transition.when ?? null,
          reason: transition.reason ?? null,
        })),
      })),
    };
  }

  /**
   * Names the step a recorded move ended on.
   *
   * A terminal move clears the onboarding's current step, so a trail alone cannot say which
   * terminal step was entered when a workflow declares more than one. The step left behind names
   * its own declared targets, so the answer is the target of that step whose status matches the
   * one recorded; failing that, any terminal step carrying that status. Returns null when the
   * revision declares nothing that could have produced the recorded status, which a trail written
   * against a different revision can do.
   */
  resolveEnteredStep(move: WorkflowRecordedMove): string | null {
    if (move.toStep !== null) {
      return move.toStep;
    }

    const leftBehind = move.appliedStep ?? move.fromStep;
    const declared =
      leftBehind === null ? [] : (this.definition.stepsByName[leftBehind]?.transitions ?? []);

    for (const candidate of declared) {
      const target =
        candidate.target === null || candidate.target === undefined
          ? undefined
          : this.definition.stepsByName[candidate.target];

      if (target?.status === move.status) {
        return target.name;
      }
    }

    return (
      this.definition.steps.find((step) => step.terminal && step.status === move.status)?.name ??
      null
    );
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
    return this.findStep(currentStep)?.getFileFieldMetadata();
  }

  /** Read-side projection of the step a client must render now, or `undefined` when there is none. */
  findStepDescription(
    currentStep: string | null | undefined,
    onboardingContext?: Readonly<Record<string, unknown>>,
  ): StepDescription | undefined {
    const step = this.findStep(currentStep);

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
    const currentStep = this.findStep(input.currentStep);
    const scoreByStep = input.scoreByStep ?? {};
    const terminalInvalidState = this.buildTerminalInvalidState(
      input.onboardingContext,
      scoreByStep,
    );

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
      scoreByStep,
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

    const currentStep = this.findStep(input.currentStep);
    const scoreByStep = input.scoreByStep ?? {};
    const terminalInvalidState = this.buildTerminalInvalidState(
      { ...(input.onboardingContext ?? {}) },
      scoreByStep,
    );

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
      scoreByStep,
      undefined,
      terminalInvalidState,
      'manual',
      persistedContext,
    );
  }

  /** The step an onboarding is on, by name — `undefined` when there is none or it names no step. */
  findStep(currentStep: string | null | undefined): Step | undefined {
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
    scoreByStep: OnboardingScoreByStep,
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
            // No arm has been resolved yet, so this step has contributed nothing so far.
            score: sumScore(scoreByStep),
            scoreByStep,
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
      scoreByStep,
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
    scoreByStep: OnboardingScoreByStep,
    rejectionReason?: WorkflowEvaluationRejectionReason,
    terminalInvalidState?: WorkflowNextState,
    invalidKind: 'terminal' | 'manual' = 'terminal',
    transitionContext?: Readonly<Record<string, unknown>>,
  ): WorkflowEvaluationResult {
    // The arm sees the score the onboarding *entered* this step with. It cannot see its own
    // points, which are not known until the arm has been chosen.
    const transition = currentStep.resolveTransition(
      trigger,
      { ...(transitionContext ?? {}), [SCORE_CONDITION_VARIABLE]: sumScore(scoreByStep) },
      trigger === 'rejected' ? (rejectionReason ?? 'CONNECTOR_REJECTED') : undefined,
    );
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

    // This application replaces whatever this step contributed before, so a workflow that loops
    // back scores its most recent outcome rather than every attempt it took to get there.
    const stepScore = currentStep.scoreFor(transition);
    const nextScoreByStep: Record<string, number> = {
      ...scoreByStep,
      [currentStep.name]: stepScore,
    };
    const score = sumScore(nextScoreByStep);

    // Skips are resolved against the score this step has just produced, so an applicant who
    // crosses a threshold here bypasses the next step immediately.
    const entered = this.resolveSkips(target, context, score);

    const terminal = entered.step.isTerminal;
    const resolvedRejectionReason: ConnectorRejectionReason | null =
      trigger === 'rejected' ? (rejectionReason ?? 'CONNECTOR_REJECTED') : null;

    const nextState: WorkflowNextState = {
      context,
      status: this.targetStatus(entered.step),
      currentStep: terminal ? null : entered.step.name,
      completedAt: terminal ? new Date() : null,
      rejectionReason: resolvedRejectionReason,
      score,
      scoreByStep: nextScoreByStep,
    };

    if (trigger === 'rejected') {
      return WorkflowEvaluationResult.rejected(
        acceptedData,
        currentStep.name,
        nextState,
        resolvedRejectionReason ?? 'CONNECTOR_REJECTED',
        transition,
        entered.skipped,
        stepScore,
      );
    }

    return WorkflowEvaluationResult.accepted(
      acceptedData,
      currentStep.name,
      nextState,
      transition,
      entered.skipped,
      stepScore,
    );
  }

  /**
   * Walks the skip chain from the step a transition resolved to.
   *
   * A step whose `skip` condition holds is never entered, so it contributes no points and its own
   * skip is considered in turn. A step skipped after having been applied earlier keeps whatever it
   * contributed then — the bypass says nothing about the outcome it already produced.
   *
   * The DDL refuses a cyclic skip graph at load, so this terminates without a hop counter.
   */
  private resolveSkips(
    target: Step,
    context: Readonly<Record<string, unknown>>,
    score: number,
  ): { step: Step; skipped: readonly string[] } {
    const skipped: string[] = [];
    let step = target;

    while (step.skip !== undefined) {
      const holds = evaluateCondition(step.skip.when, {
        ...context,
        [SCORE_CONDITION_VARIABLE]: score,
      });
      if (!holds) {
        break;
      }

      const next = this.stepsByName[step.skip.target];
      if (next === undefined) {
        break;
      }

      skipped.push(step.name);
      step = next;
    }

    return { step, skipped };
  }

  private buildTerminalInvalidState(
    onboardingContext: Readonly<Record<string, unknown>>,
    scoreByStep: OnboardingScoreByStep,
  ): WorkflowNextState {
    return {
      context: { ...onboardingContext },
      status: 'invalid',
      currentStep: null,
      completedAt: new Date(),
      rejectionReason: null,
      // An onboarding that ends invalid keeps the score it had reached; nothing was applied.
      score: sumScore(scoreByStep),
      scoreByStep,
    };
  }

  private targetStatus(step: Step | undefined): WorkflowStatus {
    return step?.status ?? 'awaiting_user';
  }

  private isRetryableInvalidData(metadata: Readonly<Record<string, unknown>> | undefined): boolean {
    return metadata?.[ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA] === true;
  }
}
