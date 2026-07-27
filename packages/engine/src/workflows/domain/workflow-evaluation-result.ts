import type { NormalizedWorkflowTransition } from '@tsh/ddl-schema';
import type { WorkflowNextState } from './workflow';

export type WorkflowEvaluationStatus =
  | 'accepted'
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

  private constructor(
    status: WorkflowEvaluationStatus,
    acceptedData?: Readonly<Record<string, unknown>>,
    appliedStep?: string,
    nextState?: WorkflowNextState,
    takenTransition?: NormalizedWorkflowTransition,
    errors: WorkflowEvaluationFieldErrors = {},
    reason?: WorkflowEvaluationInvalidReason,
    rejectionReason?: WorkflowEvaluationRejectionReason,
  ) {
    this.acceptedData = acceptedData;
    this.appliedStep = appliedStep;
    this.nextState = nextState;
    this.#takenTransition = takenTransition;
    this.#status = status;
    this.#errors = errors;
    this.#reason = reason;
    this.#rejectionReason = rejectionReason;
  }

  static accepted(
    acceptedData: Record<string, unknown>,
    appliedStep: string,
    nextState: WorkflowNextState,
    takenTransition?: NormalizedWorkflowTransition,
  ): WorkflowEvaluationResult {
    return new WorkflowEvaluationResult(
      'accepted',
      acceptedData,
      appliedStep,
      nextState,
      takenTransition,
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
  ): WorkflowEvaluationResult {
    return new WorkflowEvaluationResult(
      'rejected',
      acceptedData,
      appliedStep,
      nextState,
      takenTransition,
      undefined,
      undefined,
      rejectionReason,
    );
  }

  isAccepted(): boolean {
    return this.#status === 'accepted';
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

  getErrors(): WorkflowEvaluationFieldErrors {
    return this.#errors;
  }

  getReason(): WorkflowEvaluationInvalidReason | undefined {
    return this.#reason;
  }

  getRejectionReason(): WorkflowEvaluationRejectionReason | undefined {
    return this.#rejectionReason;
  }
}
