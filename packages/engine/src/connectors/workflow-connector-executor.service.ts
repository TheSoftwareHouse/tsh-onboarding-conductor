import { Inject, Injectable } from '@nestjs/common';
import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import {
  CONNECTOR_ADAPTER_COLLECTION,
  type ConnectorAdapter,
  type ConnectorAdapterCollection,
} from './connector.adapter';
import type { ConnectorExecutionPort } from './connector-execution.port';

@Injectable()
export class WorkflowConnectorExecutorService implements ConnectorExecutionPort {
  constructor(
    @Inject(CONNECTOR_ADAPTER_COLLECTION)
    private readonly connectors: ConnectorAdapterCollection,
  ) {}

  async execute(
    declarations: readonly NormalizedWorkflowConnectorDeclaration[],
    acceptedData: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const orderedDeclarations = [...declarations].sort((left, right) => left.order - right.order);

    for (const declaration of orderedDeclarations) {
      const adapter = this.resolveAdapter(declaration.type);
      const payload = this.buildPayload(declaration.fieldMapping, acceptedData);
      await adapter.verify(payload);
    }
  }

  private resolveAdapter(type: string): ConnectorAdapter {
    const matchingAdapters = this.connectors.filter((connector) => connector.type === type);

    if (matchingAdapters.length === 0) {
      throw new Error(`Connector not registered for type=${type}`);
    }

    if (matchingAdapters.length > 1) {
      throw new Error(`Multiple connectors registered for type=${type}`);
    }

    return matchingAdapters[0];
  }

  private buildPayload(
    fieldMapping: Readonly<Record<string, string>>,
    acceptedData: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    for (const [payloadField, sourceField] of Object.entries(fieldMapping)) {
      payload[payloadField] = acceptedData[sourceField];
    }

    return payload;
  }
}
