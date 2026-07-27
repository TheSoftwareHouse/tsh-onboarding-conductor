export type ConnectorRejectionReason =
  'ATTEMPTS_EXHAUSTED' | 'CHALLENGE_EXPIRED' | 'CHALLENGE_NOT_FOUND' | 'CONNECTOR_REJECTED';

type ConnectorExecutionStatus = 'accepted' | 'invalid' | 'invalid-data' | 'rejected';

export class ConnectorExecutionResult {
  private constructor(
    public readonly status: ConnectorExecutionStatus,
    public readonly errors?: Readonly<Record<string, readonly string[]>>,
    public readonly reason?: ConnectorRejectionReason,
  ) {}

  static accepted(): ConnectorExecutionResult {
    return new ConnectorExecutionResult('accepted');
  }

  static invalid(): ConnectorExecutionResult {
    return new ConnectorExecutionResult('invalid');
  }

  static invalidData(
    errors: Readonly<Record<string, readonly string[]>>,
  ): ConnectorExecutionResult {
    return new ConnectorExecutionResult('invalid-data', errors);
  }

  static rejected(reason: ConnectorRejectionReason): ConnectorExecutionResult {
    return new ConnectorExecutionResult('rejected', undefined, reason);
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
