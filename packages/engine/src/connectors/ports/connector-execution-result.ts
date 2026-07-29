export type ConnectorRejectionReason =
  'ATTEMPTS_EXHAUSTED' | 'CHALLENGE_EXPIRED' | 'CHALLENGE_NOT_FOUND' | 'CONNECTOR_REJECTED';

export const ConnectorExecutionMetadataFlag = {
  RETRYABLE_INVALID_DATA: 'retryableInvalidData',
} as const;

type ConnectorExecutionStatus = 'accepted' | 'invalid' | 'invalid-data' | 'rejected';

export class ConnectorExecutionResult {
  private constructor(
    public readonly status: ConnectorExecutionStatus,
    public readonly errors?: Readonly<Record<string, readonly string[]>>,
    public readonly reason?: ConnectorRejectionReason,
    public readonly metadata?: Readonly<Record<string, unknown>>,
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
}
