import type { NormalizedWorkflowTransition } from '@tsh/ddl-schema';
import type { ConnectorPendingExecution } from '../../connectors/ports/connector-execution-result';
import type { WorkflowNextState } from './workflow';

export type WorkflowEvaluationStatus =
  | 'accepted'
  | 'parked-async-callback'
  | 'rejected'
  | 'terminal-invalid'
  | 'retryable-invalid-data'
  | 'manual-transition-unavailable'
  | 'unknown-evaluation';

export type WorkflowEvaluationInvalidReason = 'UNKNOWN_STATE';

export type WorkflowEvaluationRejectionReason =
  'ATTEMPTS_EXHAUSTED' | 'CHALLENGE_EXPIRED' | 'CHALLENGE_NOT_FOUND' | 'CONNECTOR_REJECTED';

export type WorkflowEvaluationFieldErrors = Readonly<Record<string, readonly string[]>>;

type WorkflowInvalidProjection = Readonly<{
  appliedStep?: string;
  nextState?: WorkflowNextState;
}>;

type WorkflowTerminalInvalidProjection = Readonly<{
  appliedStep?: string;
  nextState: WorkflowNextState;
}>;

export class WorkflowEvaluationResult {
  readonly acceptedData?: Readonly<Record<string, unknown>>;
  readonly appliedStep?: string;
  readonly nextState?: WorkflowNextState;

  readonly #status: WorkflowEvaluationStatus;
  readonly #errors: WorkflowEvaluationFieldErrors;
  readonly #reason?: WorkflowEvaluationInvalidReason;
  readonly #rejectionReason?: WorkflowEvaluationRejectionReason;
  readonly #takenTransition?: NormalizedWorkflowTransition;
  readonly #pendingConnector?: ConnectorPendingExecution;
  /** Steps the move bypassed, in the order they were skipped. Empty unless a `skip` fired. */
  readonly #skippedSteps: readonly string[];
  /** What the applied step contributes now, which on a re-entry replaces its earlier value. */
  readonly #stepScore: number;

  private constructor(
    status: WorkflowEvaluationStatus,
    acceptedData?: Readonly<Record<string, unknown>>,
    appliedStep?: string,
    nextState?: WorkflowNextState,
    takenTransition?: NormalizedWorkflowTransition,
    pendingConnector?: ConnectorPendingExecution,
    errors: WorkflowEvaluationFieldErrors = {},
    reason?: WorkflowEvaluationInvalidReason,
    rejectionReason?: WorkflowEvaluationRejectionReason,
    skippedSteps: readonly string[] = [],
    stepScore = 0,
  ) {
    this.acceptedData = acceptedData;
    this.appliedStep = appliedStep;
    this.nextState = nextState;
    this.#takenTransition = takenTransition;
    this.#pendingConnector = pendingConnector;
    this.#status = status;
    this.#errors = errors;
    this.#reason = reason;
    this.#rejectionReason = rejectionReason;
    this.#skippedSteps = skippedSteps;
    this.#stepScore = stepScore;
  }

  static accepted(
    acceptedData: Record<string, unknown>,
    appliedStep: string,
    nextState: WorkflowNextState,
    takenTransition?: NormalizedWorkflowTransition,
    skippedSteps: readonly string[] = [],
    stepScore = 0,
  ): WorkflowEvaluationResult {
    return new WorkflowEvaluationResult(
      'accepted',
      acceptedData,
      appliedStep,
      nextState,
      takenTransition,
      undefined,
      {},
      undefined,
      undefined,
      skippedSteps,
      stepScore,
    );
  }

  static parkedAsyncCallback(
    acceptedData: Record<string, unknown>,
    appliedStep: string,
    nextState: WorkflowNextState,
    pendingConnector: ConnectorPendingExecution,
  ): WorkflowEvaluationResult {
    return new WorkflowEvaluationResult(
      'parked-async-callback',
      acceptedData,
      appliedStep,
      nextState,
      undefined,
      pendingConnector,
    );
  }

  static terminalInvalid(
    reason: WorkflowEvaluationInvalidReason,
    projection: WorkflowTerminalInvalidProjection,
  ): WorkflowEvaluationResult {
    return new WorkflowEvaluationResult(
      'terminal-invalid',
      undefined,
      projection.appliedStep,
      projection.nextState,
      undefined,
      undefined,
      {},
      reason,
    );
  }

  static retryableInvalidData(
    errors: WorkflowEvaluationFieldErrors,
    appliedStep: string,
  ): WorkflowEvaluationResult {
    return new WorkflowEvaluationResult(
      'retryable-invalid-data',
      undefined,
      appliedStep,
      undefined,
      undefined,
      undefined,
      errors,
    );
  }

  static manualTransitionUnavailable(
    projection?: WorkflowInvalidProjection,
  ): WorkflowEvaluationResult {
    return new WorkflowEvaluationResult(
      'manual-transition-unavailable',
      undefined,
      projection?.appliedStep,
      projection?.nextState,
      undefined,
      undefined,
      {},
      'UNKNOWN_STATE',
    );
  }

  static unknownEvaluation(reason: WorkflowEvaluationInvalidReason = 'UNKNOWN_STATE') {
    return new WorkflowEvaluationResult(
      'unknown-evaluation',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      reason,
    );
  }

  static rejected(
    acceptedData: Record<string, unknown>,
    appliedStep: string,
    nextState: WorkflowNextState,
    rejectionReason: WorkflowEvaluationRejectionReason,
    takenTransition?: NormalizedWorkflowTransition,
    skippedSteps: readonly string[] = [],
    stepScore = 0,
  ): WorkflowEvaluationResult {
    return new WorkflowEvaluationResult(
      'rejected',
      acceptedData,
      appliedStep,
      nextState,
      takenTransition,
      undefined,
      undefined,
      undefined,
      rejectionReason,
      skippedSteps,
      stepScore,
    );
  }

  isAccepted(): boolean {
    return this.#status === 'accepted';
  }

  isParkedAsyncCallback(): boolean {
    return this.#status === 'parked-async-callback';
  }

  isTerminalInvalid(): boolean {
    return this.#status === 'terminal-invalid';
  }

  isRetryableInvalidData(): boolean {
    return this.#status === 'retryable-invalid-data';
  }

  isManualTransitionUnavailable(): boolean {
    return this.#status === 'manual-transition-unavailable';
  }

  isUnknownEvaluation(): boolean {
    return this.#status === 'unknown-evaluation';
  }

  isRejected(): boolean {
    return this.#status === 'rejected';
  }

  getStatus(): WorkflowEvaluationStatus {
    return this.#status;
  }

  getAcceptedData(): Readonly<Record<string, unknown>> | undefined {
    return this.acceptedData;
  }

  getAppliedStep(): string | undefined {
    return this.appliedStep;
  }

  getNextState(): WorkflowNextState | undefined {
    return this.nextState;
  }

  getTakenTransition(): NormalizedWorkflowTransition | undefined {
    return this.#takenTransition;
  }

  getPendingConnector(): ConnectorPendingExecution | undefined {
    return this.#pendingConnector;
  }

  getErrors(): WorkflowEvaluationFieldErrors {
    return this.#errors;
  }

  getReason(): WorkflowEvaluationInvalidReason | undefined {
    return this.#reason;
  }

  getRejectionReason(): WorkflowEvaluationRejectionReason | undefined {
    return this.#rejectionReason;
  }

  /** Steps this move bypassed. Empty unless a `skip` condition fired. */
  getSkippedSteps(): readonly string[] {
    return this.#skippedSteps;
  }

  /** What the applied step contributes after this move; `0` when nothing was applied. */
  getStepScore(): number {
    return this.#stepScore;
  }
}
