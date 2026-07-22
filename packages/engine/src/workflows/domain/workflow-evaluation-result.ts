import type { WorkflowNextState } from './workflow';

export type WorkflowEvaluationStatus = 'accepted' | 'invalid' | 'invalid-data' | 'rejected';

export type WorkflowEvaluationInvalidReason = 'UNKNOWN_STATE';

export type WorkflowEvaluationRejectionReason =
  'ATTEMPTS_EXHAUSTED' | 'CHALLENGE_EXPIRED' | 'CHALLENGE_NOT_FOUND' | 'CONNECTOR_REJECTED';

export type WorkflowEvaluationFieldErrors = Readonly<Record<string, readonly string[]>>;

export class WorkflowEvaluationResult {
  readonly acceptedData?: Readonly<Record<string, unknown>>;
  readonly appliedStep?: string;
  readonly nextState?: WorkflowNextState;

  readonly #status: WorkflowEvaluationStatus;
  readonly #errors: WorkflowEvaluationFieldErrors;
  readonly #reason?: WorkflowEvaluationInvalidReason;
  readonly #rejectionReason?: WorkflowEvaluationRejectionReason;

  private constructor(
    status: WorkflowEvaluationStatus,
    acceptedData?: Readonly<Record<string, unknown>>,
    appliedStep?: string,
    nextState?: WorkflowNextState,
    errors: WorkflowEvaluationFieldErrors = {},
    reason?: WorkflowEvaluationInvalidReason,
    rejectionReason?: WorkflowEvaluationRejectionReason,
  ) {
    this.acceptedData = acceptedData;
    this.appliedStep = appliedStep;
    this.nextState = nextState;
    this.#status = status;
    this.#errors = errors;
    this.#reason = reason;
    this.#rejectionReason = rejectionReason;
  }

  static accepted(
    acceptedData: Record<string, unknown>,
    appliedStep: string,
    nextState: WorkflowNextState,
  ): WorkflowEvaluationResult {
    return new WorkflowEvaluationResult('accepted', acceptedData, appliedStep, nextState);
  }

  static invalid(reason: WorkflowEvaluationInvalidReason): WorkflowEvaluationResult {
    return new WorkflowEvaluationResult(
      'invalid',
      undefined,
      undefined,
      undefined,
      undefined,
      reason,
    );
  }

  static invalidData(errors: WorkflowEvaluationFieldErrors): WorkflowEvaluationResult {
    return new WorkflowEvaluationResult('invalid-data', undefined, undefined, undefined, errors);
  }

  static rejected(
    acceptedData: Record<string, unknown>,
    appliedStep: string,
    nextState: WorkflowNextState,
    rejectionReason: WorkflowEvaluationRejectionReason,
  ): WorkflowEvaluationResult {
    return new WorkflowEvaluationResult(
      'rejected',
      acceptedData,
      appliedStep,
      nextState,
      undefined,
      undefined,
      rejectionReason,
    );
  }

  isAccepted(): boolean {
    return this.#status === 'accepted';
  }

  isInvalid(): boolean {
    return this.#status === 'invalid';
  }

  isInvalidData(): boolean {
    return this.#status === 'invalid-data';
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
