import { Inject, Injectable, Optional } from '@nestjs/common';
import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import {
  CONNECTOR_MOCK_SUBSTITUTIONS,
  type ConnectorMockSubstitutions,
} from './connector-mock-substitution';
import { ConnectorAdapterNotRegisteredError } from './errors/connector-adapter-not-registered.error';
import { ConnectorPayloadFieldNotFoundError } from './errors/connector-payload-field-not-found.error';
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

  validateDeclarations(declarations: readonly NormalizedWorkflowConnectorDeclaration[]): void {
    for (const declaration of declarations) {
      const adapter = this.findAdapter(declaration.type);

      // An unregistered connector type still fails at execution time, as it always has.
      adapter?.validateDeclaration?.(declaration);
    }
  }

  findAdapterByType(
    connectorType: string,
  ): Required<Pick<ConnectorAdapter, 'type' | 'mapCallbackResult'>> & ConnectorAdapter {
    const adapter = this.getAdapter(connectorType);

    if (adapter.supportsAsyncCallback !== true || typeof adapter.mapCallbackResult !== 'function') {
      throw new Error(`Callback mapping is not supported for connector type=${connectorType}`);
    }

    return adapter as Required<Pick<ConnectorAdapter, 'type' | 'mapCallbackResult'>> &
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

      const adapter = this.getAdapter(declaration.type);
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
            `Async callback is not supported for connector type=${declaration.type} and connector name=${declaration.name}`,
          );
        }

        const initiationResult = await adapter.execute(connectorInput);
        if (!initiationResult.isAccepted()) {
          return initiationResult;
        }

        return ConnectorExecutionResult.pending({
          connectorName: declaration.name,
          connectorType: declaration.type,
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

  private findAdapter(type: string): ConnectorAdapter | undefined {
    const resolvedType = this.mockSubstitutions.get(type) ?? type;
    const matchingAdapters = this.connectors.filter((connector) => connector.type === resolvedType);

    if (matchingAdapters.length > 1) {
      throw new DuplicateConnectorAdapterRegistrationError(resolvedType);
    }

    return matchingAdapters[0];
  }

  private getAdapter(type: string): ConnectorAdapter {
    const adapter = this.findAdapter(type);

    if (!adapter) {
      throw new ConnectorAdapterNotRegisteredError(this.mockSubstitutions.get(type) ?? type);
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
        throw new ConnectorPayloadFieldNotFoundError(
          sourceField,
          declaration.type,
          declaration.name,
        );
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
