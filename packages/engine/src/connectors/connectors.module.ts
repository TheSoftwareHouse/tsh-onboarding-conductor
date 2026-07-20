import { Module } from '@nestjs/common';
import { WORKFLOW_CONNECTOR_EXECUTION_PORT } from './connector-execution.port';
import { CONNECTOR_ADAPTER_COLLECTION, type ConnectorAdapterCollection } from './connector.adapter';
import { TshKyc1Connector } from './tsh-kyc.connector';
import { TshKyc2Connector } from './tsh-kyc-2.connector';
import { WorkflowConnectorExecutorService } from './workflow-connector-executor.service';

const assertUniqueConnectorTypes = (connectors: ConnectorAdapterCollection): void => {
  const counts = new Map<string, number>();

  for (const connector of connectors) {
    counts.set(connector.type, (counts.get(connector.type) ?? 0) + 1);
  }

  const duplicateTypes = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([type]) => type)
    .sort();

  if (duplicateTypes.length > 0) {
    throw new Error(
      `Duplicate connector types are invalid at startup: ${duplicateTypes.join(', ')}`,
    );
  }
};

@Module({
  providers: [
    TshKyc1Connector,
    TshKyc2Connector,
    {
      provide: CONNECTOR_ADAPTER_COLLECTION,
      useFactory: (firstAdapter: TshKyc1Connector, secondAdapter: TshKyc2Connector) => {
        const connectors = [firstAdapter, secondAdapter] as const;
        assertUniqueConnectorTypes(connectors);
        return connectors;
      },
      inject: [TshKyc1Connector, TshKyc2Connector],
    },
    WorkflowConnectorExecutorService,
    {
      provide: WORKFLOW_CONNECTOR_EXECUTION_PORT,
      useExisting: WorkflowConnectorExecutorService,
    },
  ],
  exports: [WORKFLOW_CONNECTOR_EXECUTION_PORT],
})
export class ConnectorsModule {}
