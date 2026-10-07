import type {
  NormalizedFileField,
  NormalizedWorkflowAgreementDeclaration,
  NormalizedWorkflowConnectorDeclaration,
  NormalizedWorkflowConnectorFallback,
  NormalizedWorkflowDefinition,
  NormalizedWorkflowNotifyWebhookDeclaration,
  NormalizedWorkflowTransition,
  StepReport,
  WorkflowManualTransitionStatus,
  WorkflowStatus,
  WorkflowTransitionStatus,
} from '@tsh/ddl-schema';
import type {
  ConnectorAdapterSummary,
  ConnectorExecutionPort,
  ConnectorRejectionReason,
} from '../../connectors/ports/connector-execution.port';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
  type ConnectorPendingExecution,
} from '../../connectors/ports/connector-execution-result';
import {
  applyConnectorSelections,
  ConnectorSelectionRules,
  findSelectableConnector,
  type ConnectorVersionEntry,
  type WorkflowConnectorSelection,
} from './connector-selection';
import { Scoring } from './scoring';
import { Step, type StepDescription } from './step';
import type {
  WorkflowDefinitionResponseDto,
  WorkflowStepConnectorResponseDto,
} from '../dto/workflow-definition.response.dto';
import {
  type WorkflowEvaluationRejectionReason,
  WorkflowEvaluationResult,
} from './workflow-evaluation-result';

export type WorkflowInitializationResult = {
  workflowId: string;
  workflowVersion: number;
  status: WorkflowStatus;
  currentStep: string | null;
  scores: Record<string, number>;
};

export type WorkflowEvaluationInput = {
  currentStep: string | null | undefined;
  submittedData: unknown;
  onboardingContext: Readonly<Record<string, unknown>>;
  onboardingId: string;
  onboardingScores: Readonly<Record<string, number>>;
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
  onboardingScores: Readonly<Record<string, number>>;
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
  scores: Record<string, number>;
  /** The connector the onboarding is parked on awaiting a callback; `null` on every other state. */
  pendingConnector: ConnectorPendingExecution | null;
};

export { WorkflowEvaluationResult } from './workflow-evaluation-result';

/** The field error a client submit is refused with for a key only a connector callback may write. */
export const CALLBACK_ONLY_FIELD_ERROR = 'CALLBACK_ONLY';

/**
 * Per step, the `data` keys an asynchronous connector's callback writes — every async candidate
 * of every slot, fallbacks included, as the registry's declaration check counts them. A step with
 * none is absent.
 */
const collectCallbackFields = (
  definition: NormalizedWorkflowDefinition,
  adapters: readonly ConnectorAdapterSummary[],
): ReadonlyMap<string, ReadonlySet<string>> => {
  const fieldsByAdapterId = new Map(
    adapters.map((adapter) => [adapter.id, adapter.callbackFields]),
  );
  const fieldsByStep = new Map<string, ReadonlySet<string>>();

  for (const step of definition.steps) {
    const fields = new Set<string>();

    for (const connector of step.connectors) {
      for (const candidate of [connector, ...connector.fallbacks]) {
        if (candidate.async) {
          fieldsByAdapterId.get(candidate.id)?.forEach((field) => fields.add(field));
        }
      }
    }

    if (fields.size > 0) {
      fieldsByStep.set(step.name, fields);
    }
  }

  return fieldsByStep;
};

const projectConnector = (
  connector: NormalizedWorkflowConnectorDeclaration | NormalizedWorkflowConnectorFallback,
): WorkflowStepConnectorResponseDto => ({
  id: connector.id,
  name: connector.name,
  type: connector.type,
  order: connector.order,
  canReject: connector.canReject,
  async: connector.async,
  fieldMapping: connector.fieldMapping,
  optionalFieldMapping: connector.optionalFieldMapping,
});

export class Workflow {
  /** What the document authored; `definition` is this with the operator's selections applied. */
  private readonly authoredDefinition: NormalizedWorkflowDefinition;
  private readonly definition: NormalizedWorkflowDefinition;
  /** The steps whose primary connector a selection actually replaced. */
  private readonly selectedStepNames: ReadonlySet<string>;
  private readonly stepsByName: Readonly<Record<string, Step>>;
  private readonly scoring: Scoring;
  /** What a client submit may not carry; the callback path writes these through the same step. */
  private readonly callbackFieldsByStep: ReadonlyMap<string, ReadonlySet<string>>;

  constructor(
    definition: NormalizedWorkflowDefinition,
    readonly connectorExecutionPort?: ConnectorExecutionPort,
    /**
     * The display label the workflow is reported under: its family's for a stored revision, the
     * document's own for a compile dry run, null when neither declares one.
     */
    readonly name: string | null = null,
    connectorSelections: readonly WorkflowConnectorSelection[] = [],
  ) {
    this.authoredDefinition = definition;
    this.definition = applyConnectorSelections(definition, connectorSelections);
    this.selectedStepNames = new Set(
      connectorSelections
        .filter((selection) => {
          const step = definition.stepsByName[selection.stepName];

          return step !== undefined && findSelectableConnector(step) !== undefined;
        })
        .map((selection) => selection.stepName),
    );
    this.stepsByName = Object.fromEntries(
      Object.values(this.definition.stepsByName).map((step) => [step.name, new Step(step)]),
    );
    this.scoring = new Scoring(this.definition.scores);
    this.callbackFieldsByStep = collectCallbackFields(
      this.definition,
      connectorExecutionPort?.listAdapters?.() ?? [],
    );
  }

  get id(): string {
    return this.definition.id;
  }

  get version(): number {
    return this.definition.version;
  }

  /**
   * Every step and transition, connectors without config; `source` is null without `sourceSteps`.
   * A step's single primary connector also reports what the document authored, whether a
   * selection replaced it, and which ids `rules` would let a save bind in its place — judged
   * against the step as authored, so the list is exactly what the write accepts for this version.
   * `connectorVersions` lists, per step name, the versions a selection reaches.
   */
  describeDefinition(
    sourceSteps?: readonly StepReport[],
    rules: ConnectorSelectionRules = new ConnectorSelectionRules(undefined, []),
    connectorVersions: ReadonlyMap<string, readonly ConnectorVersionEntry[]> = new Map(),
  ): WorkflowDefinitionResponseDto {
    const sourcesByCompiledName = new Map(
      (sourceSteps ?? []).flatMap((entry) =>
        entry.compiledStepNames.map(
          (compiledName) =>
            [
              compiledName,
              { step: entry.name, type: entry.type, category: entry.category },
            ] as const,
        ),
      ),
    );

    return {
      workflowId: this.definition.id,
      workflowVersion: this.definition.version,
      name: this.name,
      initialStep: this.definition.initial,
      scores: this.definition.scores,
      webhook: this.definition.webhook
        ? { notify: { path: this.definition.webhook.notify.path } }
        : null,
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
        source: sourcesByCompiledName.get(step.name) ?? null,
        fields: [...this.stepsByName[step.name].describeFields()],
        connectors: step.connectors.map((connector, index) => {
          const authoredStep = this.authoredDefinition.stepsByName[step.name];
          const authoredId = authoredStep.connectors[index].id;

          return {
            ...projectConnector(connector),
            authoredId,
            selected: this.selectedStepNames.has(step.name),
            selectableIds: rules.listSelectableIds(authoredStep, authoredId, connector.id),
            versions:
              findSelectableConnector(authoredStep) === undefined
                ? []
                : [...(connectorVersions.get(step.name) ?? [])],
            fallbacks: connector.fallbacks.map(projectConnector),
          };
        }),
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
      scores: this.scoring.initialize(),
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

  /**
   * Every agreement family the workflow collects acceptance for, in declaration order, so an
   * onboarding start resolves and links each one once.
   */
  getDeclaredAgreementKeys(): readonly string[] {
    return this.definition.agreements.map((declaration) => declaration.key);
  }

  /**
   * The agreement families the given step collects acceptance for, empty when it collects none —
   * a caller asking whether there is work to do reads a length rather than a nullable.
   */
  findStepAgreements(stepName: string | null): readonly NormalizedWorkflowAgreementDeclaration[] {
    if (stepName === null) {
      return [];
    }

    return this.definition.agreements.filter((declaration) => declaration.step === stepName);
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
    const terminalInvalidState = this.buildTerminalInvalidState(
      input.onboardingContext,
      input.onboardingScores,
    );

    if (!currentStep || currentStep.isTerminal) {
      return WorkflowEvaluationResult.terminalInvalid('UNKNOWN_STATE', {
        nextState: terminalInvalidState,
      });
    }

    // A callback field is the provider's verdict, and on a step whose provider does not count
    // attempts also the running attempt total: a client writing either would decide its own
    // verification or reset the cap. Only the continuation — the callback or the operator
    // reconcile, applied through this same path — may carry one.
    if (input.continuation === undefined) {
      const callbackOnlyErrors = this.findCallbackOnlyErrors(currentStep.name, input.submittedData);

      if (callbackOnlyErrors !== undefined) {
        return WorkflowEvaluationResult.retryableInvalidData(callbackOnlyErrors, currentStep.name);
      }
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
      input.onboardingScores,
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
    const terminalInvalidState = this.buildTerminalInvalidState(
      { ...(input.onboardingContext ?? {}) },
      input.onboardingScores,
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
      input.onboardingScores,
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

  /** The step's callback-only keys a submit carries, as field errors; `undefined` when none. */
  private findCallbackOnlyErrors(
    stepName: string,
    submittedData: unknown,
  ): Readonly<Record<string, readonly string[]>> | undefined {
    const callbackFields = this.callbackFieldsByStep.get(stepName);

    if (
      callbackFields === undefined ||
      typeof submittedData !== 'object' ||
      submittedData === null ||
      Array.isArray(submittedData)
    ) {
      return undefined;
    }

    const refused = Object.keys(submittedData).filter((field) => callbackFields.has(field));

    return refused.length === 0
      ? undefined
      : Object.fromEntries(refused.map((field) => [field, [CALLBACK_ONLY_FIELD_ERROR]]));
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
    onboardingScores: Readonly<Record<string, number>>,
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
            scores: { ...onboardingScores },
            pendingConnector: outcome.pending!,
          },
          outcome.pending!,
        );
      }
    }

    const nextScores = this.scoring.applyRules(
      onboardingScores,
      currentStep.scoring,
      transitionContext,
    );

    return this.resolveTarget(
      currentStep,
      resolvedAcceptedData,
      resolvedTrigger,
      nextContext,
      nextScores,
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
    scores: Readonly<Record<string, number>>,
    rejectionReason?: WorkflowEvaluationRejectionReason,
    terminalInvalidState?: WorkflowNextState,
    invalidKind: 'terminal' | 'manual' = 'terminal',
    transitionContext?: Readonly<Record<string, unknown>>,
  ): WorkflowEvaluationResult {
    const transition = currentStep.resolveTransition(
      trigger,
      transitionContext,
      trigger === 'rejected' ? (rejectionReason ?? 'CONNECTOR_REJECTED') : undefined,
      scores,
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

    const terminal = target.isTerminal;
    const resolvedRejectionReason: ConnectorRejectionReason | null =
      trigger === 'rejected' ? (rejectionReason ?? 'CONNECTOR_REJECTED') : null;

    const nextState: WorkflowNextState = {
      context,
      status: this.targetStatus(target),
      currentStep: terminal ? null : target.name,
      completedAt: terminal ? new Date() : null,
      // Persisted only on a terminal move: a rejection routed to a live step (an expired code to
      // its resend step) leaves the onboarding awaiting the user, which carries no reason.
      rejectionReason: terminal ? resolvedRejectionReason : null,
      scores: { ...scores },
      pendingConnector: null,
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
    scores: Readonly<Record<string, number>>,
  ): WorkflowNextState {
    return {
      context: { ...onboardingContext },
      status: 'invalid',
      currentStep: null,
      completedAt: new Date(),
      rejectionReason: null,
      scores: { ...scores },
      pendingConnector: null,
    };
  }

  private targetStatus(step: Step | undefined): WorkflowStatus {
    return step?.status ?? 'awaiting_user';
  }

  private isRetryableInvalidData(metadata: Readonly<Record<string, unknown>> | undefined): boolean {
    return metadata?.[ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA] === true;
  }
}
