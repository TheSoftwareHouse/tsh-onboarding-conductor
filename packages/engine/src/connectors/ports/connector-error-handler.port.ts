import type {
  NormalizedWorkflowConnectorFallback,
  NormalizedWorkflowConnectorRetry,
} from '@tsh/ddl-schema';

export type ConnectorFailure = Readonly<{
  /** The declaration whose adapter threw — the primary, or its fallback. */
  declaration: NormalizedWorkflowConnectorFallback;
  execution: Readonly<{ onboardingId: string; stepName: string }>;
  error: unknown;
  /** The status the error carries when it is a Nest `HttpException`; `undefined` otherwise. */
  status?: number;
  /** 1 on this declaration's first failure; incremented only by a `retry` decision. */
  attempt: number;
  /**
   * What the workflow author allows this declaration to spend: how many attempts in total, and how
   * long the executor waits between two of them. A handler branching on `attempt` compares against
   * `retry.maxAttempts` rather than a constant of its own, so the document stays the authority.
   */
  retry: NormalizedWorkflowConnectorRetry;
  /** False when there is nothing left to fall back to — the chain has no further entry. */
  fallbackAvailable: boolean;
}>;

export const ConnectorFailureAction = {
  /** Call the same connector again. Bounded by the declaration's own `retry.maxAttempts`. */
  RETRY: 'retry',
  /** Run the next connector in the declared fallback chain in its place. */
  FALLBACK: 'fallback',
  /** Swallow the failure: this connector counts as accepted and the chain moves on. */
  CONTINUE: 'continue',
  /** Rethrow. The step does not advance and the caller sees the provider's error. */
  PROPAGATE: 'propagate',
} as const;

export type ConnectorFailureAction =
  (typeof ConnectorFailureAction)[keyof typeof ConnectorFailureAction];

export interface ConnectorErrorHandler {
  /** The value a declaration's `errorHandler` names. Unique across registered handlers. */
  readonly id: string;
  handle(failure: ConnectorFailure): ConnectorFailureAction;
}

export const CONNECTOR_ERROR_HANDLER_COLLECTION = Symbol('CONNECTOR_ERROR_HANDLER_COLLECTION');
export type ConnectorErrorHandlerCollection = readonly ConnectorErrorHandler[];

/**
 * The handler a declaration that names none gets. Declared once here so the executor and any
 * caller resolving "the default" never repeat the literal.
 */
export const DEFAULT_CONNECTOR_ERROR_HANDLER_ID = 'fallback_on_error';

/**
 * The `attempt` a fresh attempt at a declaration — a primary, or its fallback once a handler
 * decided to fall back — starts at. Part of the port's contract rather than the executor's
 * private business: a handler branching on `failure.attempt` is reading this origin, so the
 * executor that sets it and the handlers that compare against it must share one declaration.
 */
export const FIRST_CONNECTOR_ATTEMPT = 1;
