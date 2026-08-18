import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import type { ConnectorAdapter, ConnectorExecutionContext } from './connector-adapter.port';
import {
  type ConnectorRejectionReason,
  ConnectorExecutionResult,
} from './connector-execution-result';

export const WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT = Symbol(
  'WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT',
);
export const WORKFLOW_CONNECTOR_EXECUTION_PORT = WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT;

export { ConnectorRejectionReason, ConnectorExecutionResult };

export interface ConnectorExecutionPort {
  execute(
    declarations: readonly NormalizedWorkflowConnectorDeclaration[],
    context: Readonly<Record<string, unknown>>,
    execution: ConnectorExecutionContext,
  ): Promise<ConnectorExecutionResult>;

  resume(
    declarations: readonly NormalizedWorkflowConnectorDeclaration[],
    context: Readonly<Record<string, unknown>>,
    execution: ConnectorExecutionContext,
    completedConnectorOrder: number,
    resolvedResult: ConnectorExecutionResult,
  ): Promise<ConnectorExecutionResult>;

  findAdapterByType?(
    connectorType: string,
  ): Required<Pick<ConnectorAdapter, 'type' | 'mapCallbackResult'>> & ConnectorAdapter;

  validateDeclarations?(declarations: readonly NormalizedWorkflowConnectorDeclaration[]): void;
}
