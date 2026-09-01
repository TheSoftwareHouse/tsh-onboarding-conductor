import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import type {
  ConnectorFailureAuditAction,
  ConnectorFailureAuditMetadata,
} from '../audit/audit.types';
import {
  CONNECTOR_MOCK_SUBSTITUTIONS,
  type ConnectorMockSubstitutions,
} from './connector-mock-substitution';
import { ConnectorAdapterNotRegisteredError } from './errors/connector-adapter-not-registered.error';
import { ConnectorErrorHandlerInvalidActionError } from './errors/connector-error-handler-invalid-action.error';
import { ConnectorErrorHandlerNotRegisteredError } from './errors/connector-error-handler-not-registered.error';
import { ConnectorPayloadFieldNotFoundError } from './errors/connector-payload-field-not-found.error';
import { ConnectorTypeMismatchError } from './errors/connector-type-mismatch.error';
import { DuplicateConnectorAdapterRegistrationError } from './errors/duplicate-connector-adapter-registration.error';
import {
  CONNECTOR_ADAPTER_COLLECTION,
  type ConnectorAdapter,
  type ConnectorAdapterCollection,
} from './ports/connector-adapter.port';
import {
  CONNECTOR_ERROR_HANDLER_COLLECTION,
  ConnectorFailureAction,
  DEFAULT_CONNECTOR_ERROR_HANDLER_ID,
  FIRST_CONNECTOR_ATTEMPT,
  type ConnectorErrorHandler,
  type ConnectorErrorHandlerCollection,
  type ConnectorFailure,
} from './ports/connector-error-handler.port';
import { ConnectorExecutionResult } from './ports/connector-execution-result';
import type { ConnectorExecutionPort } from './ports/connector-execution.port';

/** Total attempts a `retry` decision may spend on one declaration, initiation included. */
const MAX_CONNECTOR_ATTEMPTS = 3;

/**
 * How many scheduled audit writes may be in flight before further ones are dropped. Each write
 * acquires its own pooled connection (see `scheduleConnectorFailureAudit`) and nothing awaits it,
 * so without a cap a provider outage — the condition this whole feature exists for — would let
 * failing submits queue acquires faster than the pool retires them, and `pg`'s default
 * `connectionTimeoutMillis: 0` never gives one up. Dropping the excess keeps a best-effort
 * observation from competing with the request traffic it is only describing.
 */
export const MAX_PENDING_CONNECTOR_FAILURE_AUDITS = 100;

/** How long shutdown waits for scheduled audit writes to drain before giving up on them. */
const CONNECTOR_FAILURE_AUDIT_FLUSH_TIMEOUT_MS = 5000;

/** Reasons the executor overrides a handler's decision rather than trusting its arithmetic. */
const CONNECTOR_FAILURE_OVERRIDE = {
  ATTEMPTS_EXHAUSTED: 'attempts_exhausted',
  FALLBACK_UNAVAILABLE: 'fallback_unavailable',
  /** The handler returned a string outside `ConnectorFailureAction` — a handler-authoring bug. */
  INVALID_HANDLER_ACTION: 'invalid_handler_action',
} as const;

/** The audit action recorded for each decision the executor ends up acting on. */
const CONNECTOR_FAILURE_AUDIT_ACTION: Record<ConnectorFailureAction, ConnectorFailureAuditAction> =
  {
    [ConnectorFailureAction.RETRY]: 'connector.failure_retried',
    [ConnectorFailureAction.FALLBACK]: 'connector.failure_fell_back',
    [ConnectorFailureAction.CONTINUE]: 'connector.failure_ignored',
    [ConnectorFailureAction.PROPAGATE]: 'connector.failure_propagated',
  };

/** Every action a handler may legitimately return — what a decision is checked against before the
 *  executor acts on it, so a third-party handler cannot smuggle an out-of-contract string past the
 *  audit lookup (see `ConnectorErrorHandlerInvalidActionError`). */
const CONNECTOR_FAILURE_ACTIONS: readonly ConnectorFailureAction[] =
  Object.values(ConnectorFailureAction);

@Injectable()
export class WorkflowConnectorExecutorService implements ConnectorExecutionPort, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowConnectorExecutorService.name);
  /**
   * Audit writes scheduled but not yet settled. Bounded by
   * `MAX_PENDING_CONNECTOR_FAILURE_AUDITS`, and drained by `flushConnectorFailureAudits` — on
   * shutdown, and in tests as a deterministic point to wait for rather than a sleep. See
   * `scheduleConnectorFailureAudit`.
   */
  private readonly pendingConnectorFailureAudits = new Set<Promise<void>>();

  constructor(
    @Inject(CONNECTOR_ADAPTER_COLLECTION)
    private readonly connectors: ConnectorAdapterCollection,
    @Inject(CONNECTOR_ERROR_HANDLER_COLLECTION)
    private readonly errorHandlers: ConnectorErrorHandlerCollection,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
    /**
     * Sends a declared connector type to the mock standing in for it, so a workflow declaring
     * `twilio_verify` reaches the fixture without any test-only declaration.
     */
    @Optional()
    @Inject(CONNECTOR_MOCK_SUBSTITUTIONS)
    private readonly mockSubstitutions: ConnectorMockSubstitutions = new Map(),
  ) {}

  async execute(
    declarations: readonly NormalizedWorkflowConnectorDeclaration[],
    context: Readonly<Record<string, unknown>>,
    execution: Readonly<{ onboardingId: string; stepName: string }>,
  ): Promise<ConnectorExecutionResult> {
    return this.executeNext(declarations, context, execution, Number.NEGATIVE_INFINITY);
  }

  async resume(
    declarations: readonly NormalizedWorkflowConnectorDeclaration[],
    context: Readonly<Record<string, unknown>>,
    execution: Readonly<{ onboardingId: string; stepName: string }>,
    completedConnectorOrder: number,
    resolvedResult: ConnectorExecutionResult,
  ): Promise<ConnectorExecutionResult> {
    return this.executeNext(
      declarations,
      context,
      execution,
      completedConnectorOrder,
      resolvedResult,
    );
  }

  /**
   * A declaration names its adapter by `id` and repeats the adapter's capability as its `type`.
   * A repeated value that disagrees with the adapter is an authoring mistake, and the adapter is
   * the authority, so it fails startup rather than leaving the workflow document lying about what
   * it calls. An unregistered id still fails at execution time, as it always has.
   *
   * A declaration's `errorHandler` (defaulting to `fallback_on_error`) must resolve to a
   * registered handler, and its `fallback` — when declared — is validated exactly like a primary:
   * same adapter-`type` agreement, then the adapter's own `validateDeclaration`. The fallback
   * carries no `errorHandler` of its own, so the primary and its fallback are validated in the
   * same pass rather than a duplicated loop body.
   */
  validateDeclarations(declarations: readonly NormalizedWorkflowConnectorDeclaration[]): void {
    for (const declaration of declarations) {
      this.getErrorHandler(declaration.errorHandler ?? DEFAULT_CONNECTOR_ERROR_HANDLER_ID);

      const candidates = declaration.fallback ? [declaration, declaration.fallback] : [declaration];

      for (const candidate of candidates) {
        const adapter = this.findAdapter(candidate.id);

        if (adapter !== undefined && adapter.type !== candidate.type) {
          throw new ConnectorTypeMismatchError(candidate.id, candidate.type, adapter.type);
        }

        // A fallback inherits the primary's `async`, but only its own adapter's capability
        // decides whether that holds up. Checked here, at boot, so an `async: true` primary
        // paired with a non-callback-capable fallback fails the boot rather than surfacing as a
        // bare Error out of the `FALLBACK` branch — masking the primary's real failure at exactly
        // the moment the fallback was meant to rescue the onboarding.
        if (
          candidate === declaration.fallback &&
          candidate.async === true &&
          adapter !== undefined &&
          adapter.supportsAsyncCallback !== true
        ) {
          throw new Error(
            `Async callback is not supported for fallback connector id=${candidate.id} and connector name=${candidate.name}`,
          );
        }

        adapter?.validateDeclaration?.(candidate);
      }
    }
  }

  findAdapterById(
    connectorId: string,
  ): Required<Pick<ConnectorAdapter, 'id' | 'mapCallbackResult'>> & ConnectorAdapter {
    const adapter = this.getAdapter(connectorId);

    if (adapter.supportsAsyncCallback !== true || typeof adapter.mapCallbackResult !== 'function') {
      throw new Error(`Callback mapping is not supported for connector id=${connectorId}`);
    }

    return adapter as Required<Pick<ConnectorAdapter, 'id' | 'mapCallbackResult'>> &
      ConnectorAdapter;
  }

  private async executeNext(
    declarations: readonly NormalizedWorkflowConnectorDeclaration[],
    context: Readonly<Record<string, unknown>>,
    execution: Readonly<{ onboardingId: string; stepName: string }>,
    resolvedConnectorOrder: number,
    resolvedResult?: ConnectorExecutionResult,
  ): Promise<ConnectorExecutionResult> {
    const orderedDeclarations = [...declarations].sort((left, right) => left.order - right.order);
    let lastAcceptedResult: ConnectorExecutionResult | null = null;

    for (const declaration of orderedDeclarations) {
      if (declaration.order < resolvedConnectorOrder) {
        continue;
      }

      if (declaration.order === resolvedConnectorOrder) {
        if (!resolvedResult) {
          continue;
        }

        if (!resolvedResult.isAccepted()) {
          return resolvedResult;
        }

        continue;
      }

      const handler = this.getErrorHandler(
        declaration.errorHandler ?? DEFAULT_CONNECTOR_ERROR_HANDLER_ID,
      );
      const result = await this.attemptDeclaration(
        declaration,
        handler,
        context,
        execution,
        FIRST_CONNECTOR_ATTEMPT,
      );

      if (!result.isAccepted()) {
        return result;
      }

      lastAcceptedResult = result;
    }

    if (!lastAcceptedResult) {
      return ConnectorExecutionResult.accepted();
    }

    return lastAcceptedResult;
  }

  /**
   * One attempt at one declaration — the primary, or its fallback once a handler decided to fall
   * back. Adapter resolution, payload building and the `supportsAsyncCallback` assertion all run
   * before the `try`: each is an authoring mistake, not a connector failure, and routing it
   * through a handler would hide it behind a fallback. `adapter.execute(...)` is the only thing
   * that may fail into the handler, so it — and the deterministic conversion of its result into a
   * `pending` on an `async` declaration — stay inside the `try`, keeping the success and failure
   * paths explicit rather than assigning a `let` that is read again after the `catch`.
   */
  private async attemptDeclaration(
    declaration: NormalizedWorkflowConnectorDeclaration,
    handler: ConnectorErrorHandler,
    context: Readonly<Record<string, unknown>>,
    execution: Readonly<{ onboardingId: string; stepName: string }>,
    attempt: number,
  ): Promise<ConnectorExecutionResult> {
    const adapter = this.getAdapter(declaration.id);
    const payloadBuild = this.buildPayload(declaration, context);
    const connectorInput = {
      declaration: {
        order: declaration.order,
        config: this.cloneJsonCompatible(declaration.config),
        async: declaration.async === true,
      },
      execution: { ...execution },
      context: { ...context },
      payload: { ...payloadBuild.payload },
      payloadFieldSources: { ...payloadBuild.payloadFieldSources },
    };

    if (declaration.async === true && adapter.supportsAsyncCallback !== true) {
      throw new Error(
        `Async callback is not supported for connector id=${declaration.id} and connector name=${declaration.name}`,
      );
    }

    try {
      const executionResult = await adapter.execute(connectorInput);

      if (declaration.async !== true || !executionResult.isAccepted()) {
        return executionResult;
      }

      return ConnectorExecutionResult.pending({
        connectorName: declaration.name,
        connectorId: declaration.id,
        connectorOrder: declaration.order,
      });
    } catch (error) {
      return this.handleConnectorFailure(declaration, handler, context, execution, attempt, error);
    }
  }

  /**
   * Asks the declaration's handler what to do with a thrown error, then acts on it. A `retry`
   * past `MAX_CONNECTOR_ATTEMPTS`, a `fallback` with nothing declared, and an out-of-contract
   * action a handler returns are all overridden to `propagate` rather than trusted — the executor
   * is the loop guard and the contract's gatekeeper, the handler is only the policy. Exactly one
   * audit row and one application-log line are written per decision, naming the *effective* action
   * (post-override) so the two agree.
   */
  private async handleConnectorFailure(
    declaration: NormalizedWorkflowConnectorDeclaration,
    handler: ConnectorErrorHandler,
    context: Readonly<Record<string, unknown>>,
    execution: Readonly<{ onboardingId: string; stepName: string }>,
    attempt: number,
    error: unknown,
  ): Promise<ConnectorExecutionResult> {
    const failure: ConnectorFailure = {
      declaration,
      execution,
      error,
      status: error instanceof HttpException ? error.getStatus() : undefined,
      attempt,
      fallbackAvailable: declaration.fallback !== undefined,
    };
    const rawDecision = handler.handle(failure);
    const decisionIsValid = CONNECTOR_FAILURE_ACTIONS.includes(rawDecision);

    if (!decisionIsValid) {
      this.logger.error(
        new ConnectorErrorHandlerInvalidActionError(handler.id, rawDecision).message,
      );
    }

    const decision = decisionIsValid ? rawDecision : ConnectorFailureAction.PROPAGATE;
    const attemptsExhausted =
      decision === ConnectorFailureAction.RETRY && attempt >= MAX_CONNECTOR_ATTEMPTS;
    const fallbackUnavailable =
      decision === ConnectorFailureAction.FALLBACK && !failure.fallbackAvailable;
    const action =
      attemptsExhausted || fallbackUnavailable ? ConnectorFailureAction.PROPAGATE : decision;
    const override = attemptsExhausted
      ? CONNECTOR_FAILURE_OVERRIDE.ATTEMPTS_EXHAUSTED
      : fallbackUnavailable
        ? CONNECTOR_FAILURE_OVERRIDE.FALLBACK_UNAVAILABLE
        : !decisionIsValid
          ? CONNECTOR_FAILURE_OVERRIDE.INVALID_HANDLER_ACTION
          : undefined;

    this.logConnectorFailureWarning(failure, handler, action, override, declaration.fallback);
    this.scheduleConnectorFailureAudit(failure, handler, action, override, declaration.fallback);

    if (action === ConnectorFailureAction.RETRY) {
      return this.attemptDeclaration(declaration, handler, context, execution, attempt + 1);
    }

    if (action === ConnectorFailureAction.FALLBACK) {
      return this.attemptDeclaration(
        declaration.fallback as NormalizedWorkflowConnectorDeclaration,
        handler,
        context,
        execution,
        FIRST_CONNECTOR_ATTEMPT,
      );
    }

    if (action === ConnectorFailureAction.CONTINUE) {
      return ConnectorExecutionResult.accepted();
    }

    throw error;
  }

  /**
   * Logs one application-log line for a decision the executor is about to act on: the failing
   * connector, the handler, the action and — on a `fallback` — the connector taking over, so an
   * operator reading logs sees what it fell back to and not only that it fell back.
   */
  private logConnectorFailureWarning(
    failure: ConnectorFailure,
    handler: ConnectorErrorHandler,
    action: ConnectorFailureAction,
    override: string | undefined,
    fallback: NormalizedWorkflowConnectorDeclaration | undefined,
  ): void {
    const errorMessage =
      failure.error instanceof Error ? failure.error.message : String(failure.error);
    const fallbackDetail =
      action === ConnectorFailureAction.FALLBACK && fallback
        ? ` fallbackConnectorId=${fallback.id} fallbackConnectorName=${fallback.name}`
        : '';

    this.logger.warn(
      `Connector failure: onboarding=${failure.execution.onboardingId} step=${failure.execution.stepName} ` +
        `connectorId=${failure.declaration.id} connectorName=${failure.declaration.name} ` +
        `handler=${handler.id} action=${action}${override ? ` (${override})` : ''}${fallbackDetail}: ${errorMessage}`,
    );
  }

  /**
   * Schedules a decision's audit write rather than awaiting it inside the connector chain. The
   * chain runs *inside* `OnboardingsService`'s own `dataSource.transaction(...)`, which already
   * holds one of the pool's connections; awaiting a second acquire here — as this used to — is
   * hold-and-wait on the same pool, and with `pg`'s defaults (`max: 10`,
   * `connectionTimeoutMillis: 0`, which waits forever) enough concurrent failures deadlock the
   * engine permanently while holding row locks. Firing the write instead lets the submit's
   * transaction commit or roll back — releasing its connection — before the queued acquire
   * proceeds, while the row still lands in its own transaction (`AuditService.logConnectorFailure`
   * opens one) and still survives a rolled-back submit. A write that itself rejects is caught
   * right here, logged, and never surfaces as an unhandled rejection or changes the chain's
   * outcome. `flushConnectorFailureAudits` gives a caller — a test, chiefly — a deterministic
   * point to wait for every write scheduled so far, instead of a sleep.
   */
  private scheduleConnectorFailureAudit(
    failure: ConnectorFailure,
    handler: ConnectorErrorHandler,
    action: ConnectorFailureAction,
    override: string | undefined,
    fallback: NormalizedWorkflowConnectorDeclaration | undefined,
  ): void {
    if (this.pendingConnectorFailureAudits.size >= MAX_PENDING_CONNECTOR_FAILURE_AUDITS) {
      this.logger.error(
        `Dropped connector failure audit for onboarding=${failure.execution.onboardingId} ` +
          `step=${failure.execution.stepName} connectorId=${failure.declaration.id}: ` +
          `${MAX_PENDING_CONNECTOR_FAILURE_AUDITS} writes are already in flight`,
      );

      return;
    }

    const metadata: ConnectorFailureAuditMetadata = {
      stepName: failure.execution.stepName,
      connectorId: failure.declaration.id,
      connectorName: failure.declaration.name,
      connectorOrder: failure.declaration.order,
      errorHandler: handler.id,
      attempt: failure.attempt,
      errorName: failure.error instanceof Error ? failure.error.name : 'UnknownError',
    };

    if (failure.status !== undefined) {
      metadata.status = failure.status;
    }

    if (action === ConnectorFailureAction.FALLBACK && fallback) {
      metadata.fallbackConnectorId = fallback.id;
      metadata.fallbackConnectorName = fallback.name;
    }

    if (override !== undefined) {
      metadata.override = override;
    }

    const write = this.auditService
      .logConnectorFailure(this.dataSource, {
        action: CONNECTOR_FAILURE_AUDIT_ACTION[action],
        resourceId: failure.execution.onboardingId,
        metadata,
      })
      .then(
        () => undefined,
        (auditError: unknown) => {
          this.logger.error(
            `Failed to record connector failure audit for onboarding=${failure.execution.onboardingId}: ` +
              `${auditError instanceof Error ? auditError.message : String(auditError)}`,
          );
        },
      );

    this.pendingConnectorFailureAudits.add(write);
    void write.finally(() => this.pendingConnectorFailureAudits.delete(write));
  }

  /**
   * Drains the scheduled writes on shutdown, so a decision recorded moments before the process
   * stops is not lost with it. Bounded: the connector chain never waits on these writes, and a
   * write blocked on a starved pool must not hold shutdown open either — the audit contract calls
   * this family best effort.
   */
  async onModuleDestroy(): Promise<void> {
    await this.flushConnectorFailureAudits(CONNECTOR_FAILURE_AUDIT_FLUSH_TIMEOUT_MS);
  }

  /**
   * Waits for every connector-failure audit write scheduled so far to settle, optionally giving
   * up after `timeoutMs`. Called on shutdown with a bound; tests call it without one as a
   * deterministic point to assert against instead of a sleep. The connector chain itself never
   * calls it — the whole point of scheduling (see `scheduleConnectorFailureAudit`) is that it
   * does not wait on these writes.
   */
  async flushConnectorFailureAudits(timeoutMs?: number): Promise<void> {
    const settled = Promise.all(this.pendingConnectorFailureAudits).then(() => undefined);

    if (timeoutMs === undefined) {
      return settled;
    }

    await Promise.race([
      settled,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref()),
    ]);
  }

  /**
   * A step's connector declaration names the adapter through its `type` field, which carries the
   * adapter's `id` — the DDL kept the field name it has always had, so the argument arrives as a
   * declaration `type` and is matched against `ConnectorAdapter.id`.
   */
  private findAdapter(connectorId: string): ConnectorAdapter | undefined {
    const resolvedId = this.mockSubstitutions.get(connectorId) ?? connectorId;
    const matchingAdapters = this.connectors.filter((connector) => connector.id === resolvedId);

    if (matchingAdapters.length > 1) {
      throw new DuplicateConnectorAdapterRegistrationError(resolvedId);
    }

    return matchingAdapters[0];
  }

  private getAdapter(connectorId: string): ConnectorAdapter {
    const adapter = this.findAdapter(connectorId);

    if (!adapter) {
      throw new ConnectorAdapterNotRegisteredError(
        this.mockSubstitutions.get(connectorId) ?? connectorId,
      );
    }

    return adapter;
  }

  private getErrorHandler(id: string): ConnectorErrorHandler {
    const handler = this.errorHandlers.find((candidate) => candidate.id === id);

    if (!handler) {
      throw new ConnectorErrorHandlerNotRegisteredError(id);
    }

    return handler;
  }

  private buildPayload(
    declaration: NormalizedWorkflowConnectorDeclaration,
    context: Readonly<Record<string, unknown>>,
  ): { payload: Record<string, unknown>; payloadFieldSources: Record<string, string> } {
    const payload: Record<string, unknown> = {};
    const payloadFieldSources: Record<string, string> = {};

    for (const [payloadField, sourceField] of Object.entries(declaration.fieldMapping)) {
      if (!Object.prototype.hasOwnProperty.call(context, sourceField)) {
        throw new ConnectorPayloadFieldNotFoundError(sourceField, declaration.id, declaration.name);
      }

      payload[payloadField] = context[sourceField];
      payloadFieldSources[payloadField] = sourceField;
    }

    return { payload, payloadFieldSources };
  }

  private cloneJsonCompatible<T>(value: T): T {
    return structuredClone(value);
  }
}
