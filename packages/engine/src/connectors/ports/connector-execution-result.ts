export type ConnectorRejectionReason =
  'ATTEMPTS_EXHAUSTED' | 'CHALLENGE_EXPIRED' | 'CHALLENGE_NOT_FOUND' | 'CONNECTOR_REJECTED';

export const ConnectorExecutionMetadataFlag = {
  RETRYABLE_INVALID_DATA: 'retryableInvalidData',
} as const;

export type ConnectorExecutionStatus =
  'accepted' | 'invalid' | 'invalid-data' | 'pending' | 'rejected';

export type ConnectorPendingExecution = Readonly<{
  connectorName: string;
  connectorType: string;
  connectorOrder: number;
}>;

export type ResolvedConnector = Readonly<{
  connectorOrder: number;
}>;

export type ConnectorCallbackResult = Readonly<{
  onboardingId: string;
  submittedData: unknown;
  resolvedConnector: ResolvedConnector;
  result: ConnectorExecutionResult;
}>;

export class ConnectorExecutionResult {
  private constructor(
    public readonly status: ConnectorExecutionStatus,
    public readonly errors?: Readonly<Record<string, readonly string[]>>,
    public readonly reason?: ConnectorRejectionReason,
    public readonly metadata?: Readonly<Record<string, unknown>>,
    public readonly pending?: ConnectorPendingExecution,
  ) {}

  static accepted(metadata?: Readonly<Record<string, unknown>>): ConnectorExecutionResult {
    return new ConnectorExecutionResult('accepted', undefined, undefined, metadata);
  }

  static invalid(metadata?: Readonly<Record<string, unknown>>): ConnectorExecutionResult {
    return new ConnectorExecutionResult('invalid', undefined, undefined, metadata);
  }

  static invalidData(
    errors: Readonly<Record<string, readonly string[]>>,
    metadata?: Readonly<Record<string, unknown>>,
  ): ConnectorExecutionResult {
    return new ConnectorExecutionResult('invalid-data', errors, undefined, metadata);
  }

  static pending(pending: ConnectorPendingExecution): ConnectorExecutionResult {
    return new ConnectorExecutionResult('pending', undefined, undefined, undefined, pending);
  }

  static rejected(
    reason: ConnectorRejectionReason,
    metadata?: Readonly<Record<string, unknown>>,
  ): ConnectorExecutionResult {
    return new ConnectorExecutionResult('rejected', undefined, reason, metadata);
  }

  isAccepted(): boolean {
    return this.status === 'accepted';
  }

  isInvalid(): boolean {
    return this.status === 'invalid';
  }

  isInvalidData(): boolean {
    return this.status === 'invalid-data';
  }

  isRejected(): boolean {
    return this.status === 'rejected';
  }

  isPending(): boolean {
    return this.status === 'pending';
  }
}
