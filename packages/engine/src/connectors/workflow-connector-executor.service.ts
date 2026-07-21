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
  ): Promise<void> {
    const orderedDeclarations = [...declarations].sort((left, right) => left.order - right.order);

    for (const declaration of orderedDeclarations) {
      const adapter = this.resolveAdapter(declaration.type);
      const payload = this.buildPayload(declaration, context);
      await adapter.verify({ context: { ...context }, payload: { ...payload } });
    }
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
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    const fieldMappings = Object.entries(declaration.fieldMapping) as ReadonlyArray<
      readonly [string, string]
    >;

    for (const [payloadField, sourceField] of fieldMappings) {
      if (!Object.prototype.hasOwnProperty.call(context, sourceField)) {
        throw new ConnectorPayloadFieldNotFoundError(
          sourceField,
          declaration.type,
          declaration.name,
        );
      }

      payload[payloadField] = context[sourceField];
    }

    return payload;
  }
}
