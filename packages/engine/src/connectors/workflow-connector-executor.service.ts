import { Inject, Injectable } from '@nestjs/common';
import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
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
  ) {}

  async execute(
    declarations: readonly NormalizedWorkflowConnectorDeclaration[],
    context: Readonly<Record<string, unknown>>,
    execution: Readonly<{ onboardingId: string; stepName: string }>,
  ): Promise<ConnectorExecutionResult> {
    return this.executeGreaterOrders(declarations, context, execution, Number.NEGATIVE_INFINITY);
  }

  async continueAfter(
    declarations: readonly NormalizedWorkflowConnectorDeclaration[],
    context: Readonly<Record<string, unknown>>,
    execution: Readonly<{ onboardingId: string; stepName: string }>,
    completedConnectorOrder: number,
    resolvedResult: ConnectorExecutionResult,
  ): Promise<ConnectorExecutionResult> {
    return this.executeGreaterOrders(
      declarations,
      context,
      execution,
      completedConnectorOrder,
      resolvedResult,
    );
  }

  resolveAsyncCallbackAdapterByType(
    connectorType: string,
  ): Required<Pick<ConnectorAdapter, 'type' | 'mapCallbackResult'>> & ConnectorAdapter {
    const adapter = this.resolveAdapter(connectorType);

    if (adapter.supportsAsyncCallback !== true || typeof adapter.mapCallbackResult !== 'function') {
      throw new Error(`Callback mapping is not supported for connector type=${connectorType}`);
    }

    return adapter as Required<Pick<ConnectorAdapter, 'type' | 'mapCallbackResult'>> &
      ConnectorAdapter;
  }

  private async executeGreaterOrders(
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

      const adapter = this.resolveAdapter(declaration.type);

      if (declaration.async === true) {
        if (adapter.supportsAsyncCallback !== true) {
          throw new Error(
            `Async callback is not supported for connector type=${declaration.type} and connector name=${declaration.name}`,
          );
        }

        return ConnectorExecutionResult.pending({
          connectorName: declaration.name,
          connectorType: declaration.type,
          connectorOrder: declaration.order,
        });
      }

      const payloadBuild = this.buildPayload(declaration, context);
      const declarationConfig = this.cloneJsonCompatible(declaration.config);
      const executionResult = await adapter.execute({
        declaration: {
          config: declarationConfig,
        },
        execution: { ...execution },
        context: { ...context },
        payload: { ...payloadBuild.payload },
        payloadFieldSources: { ...payloadBuild.payloadFieldSources },
      });
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

  private resolveAdapter(type: string): ConnectorAdapter {
    const matchingAdapters = this.connectors.filter((connector) => connector.type === type);

    if (matchingAdapters.length === 0) {
      throw new ConnectorAdapterNotRegisteredError(type);
    }

    if (matchingAdapters.length > 1) {
      throw new DuplicateConnectorAdapterRegistrationError(type);
    }

    return matchingAdapters[0];
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
