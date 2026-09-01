import type { NormalizedWorkflowConnectorFallback } from '@tsh/ddl-schema';

export type ConnectorFailure = Readonly<{
  /** The declaration whose adapter threw — the primary, or its fallback. */
  declaration: NormalizedWorkflowConnectorFallback;
  execution: Readonly<{ onboardingId: string; stepName: string }>;
  error: unknown;
  /** The status the error carries when it is a Nest `HttpException`; `undefined` otherwise. */
  status?: number;
  /** 1 on this declaration's first failure; incremented only by a `retry` decision. */
  attempt: number;
  /** False when there is nothing left to fall back to — no fallback declared, or this *is* it. */
  fallbackAvailable: boolean;
}>;

export const ConnectorFailureAction = {
  /** Call the same connector again. Bounded by MAX_CONNECTOR_ATTEMPTS. */
  RETRY: 'retry',
  /** Run the declared fallback in its place. */
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
