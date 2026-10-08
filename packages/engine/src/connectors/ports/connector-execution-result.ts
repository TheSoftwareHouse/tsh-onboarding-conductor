// Declared in the DDL package: a workflow document names these on a `rejected` transition, so the
// schema has to know them, and there must be exactly one declaration of the set.
export { CONNECTOR_REJECTION_REASONS, type ConnectorRejectionReason } from '@tsh/ddl-schema';
import type { ConnectorRejectionReason } from '@tsh/ddl-schema';

export const ConnectorExecutionMetadataFlag = {
  RETRYABLE_INVALID_DATA: 'retryableInvalidData',
} as const;

export type ConnectorExecutionStatus =
  'accepted' | 'invalid' | 'invalid-data' | 'pending' | 'rejected';

/**
 * Names the parked connector with the declaration's own `name` and `id`. `providerReference` is
 * the provider-side handle of the attempt the park waits on (a verification session id), when
 * the adapter reports one; it lets a callback for a superseded attempt be told apart. `parkedAt`
 * is when the park was first written — a re-park keeps it — so an operator can see how long an
 * onboarding has waited; absent on a row parked before it was recorded.
 */
export type ConnectorPendingExecution = Readonly<{
  connectorName: string;
  connectorId: string;
  connectorOrder: number;
  providerReference?: string;
  parkedAt?: string;
}>;

/**
 * `pendingConnector` is the park the adapter correlated the callback against, read without a
 * lock; the submit path compares it with the row it locks so a decision computed for a park the
 * onboarding has since left is dropped rather than applied.
 */
export type ResolvedConnector = Readonly<{
  connectorOrder: number;
  pendingConnector?: ConnectorPendingExecution;
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
