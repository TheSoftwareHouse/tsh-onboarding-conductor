import { Inject, Injectable, Optional } from '@nestjs/common';
import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import {
  CONNECTOR_MOCK_SUBSTITUTIONS,
  type ConnectorMockSubstitutions,
} from './connector-mock-substitution';
import { ConnectorAdapterNotRegisteredError } from './errors/connector-adapter-not-registered.error';
import { ConnectorPayloadFieldNotFoundError } from './errors/connector-payload-field-not-found.error';
import { ConnectorTypeMismatchError } from './errors/connector-type-mismatch.error';
import { DuplicateConnectorAdapterRegistrationError } from './errors/duplicate-connector-adapter-registration.error';
import {
  CONNECTOR_ADAPTER_COLLECTION,
  type ConnectorAdapter,
  type ConnectorAdapterCollection,
} from './ports/connector-adapter.port';
import { ConnectorExecutionResult } from './ports/connector-execution-result';
import type { ConnectorExecutionPort } from './ports/connector-execution.port';

@Injectable()
export class WorkflowConnectorExecutorService implements ConnectorExecutionPort {
  constructor(
    @Inject(CONNECTOR_ADAPTER_COLLECTION)
    private readonly connectors: ConnectorAdapterCollection,
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
   */
  validateDeclarations(declarations: readonly NormalizedWorkflowConnectorDeclaration[]): void {
    for (const declaration of declarations) {
      const adapter = this.findAdapter(declaration.id);

      if (adapter !== undefined && adapter.type !== declaration.type) {
        throw new ConnectorTypeMismatchError(declaration.id, declaration.type, adapter.type);
      }

      adapter?.validateDeclaration?.(declaration);
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

      if (declaration.async === true) {
        if (adapter.supportsAsyncCallback !== true) {
          throw new Error(
            `Async callback is not supported for connector id=${declaration.id} and connector name=${declaration.name}`,
          );
        }

        const initiationResult = await adapter.execute(connectorInput);
        if (!initiationResult.isAccepted()) {
          return initiationResult;
        }

        return ConnectorExecutionResult.pending({
          connectorName: declaration.name,
          connectorId: declaration.id,
          connectorOrder: declaration.order,
        });
      }

      const executionResult = await adapter.execute(connectorInput);
      if (!executionResult.isAccepted()) {
        return executionResult;
      }

      lastAcceptedResult = executionResult;
    }

    if (!lastAcceptedResult) {
      return ConnectorExecutionResult.accepted();
    }

    return lastAcceptedResult;
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
