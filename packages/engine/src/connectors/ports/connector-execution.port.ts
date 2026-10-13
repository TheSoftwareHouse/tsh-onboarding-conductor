import type { ConnectorType, NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import type { ConnectorScope } from '../connector-adapter-scope';
import type { ConnectorAdapter } from './connector-adapter.port';
import {
  type ConnectorRejectionReason,
  ConnectorExecutionResult,
} from './connector-execution-result';

export const WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT = Symbol(
  'WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT',
);
export const WORKFLOW_CONNECTOR_EXECUTION_PORT = WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT;

/** The shape of a connector id: what a declaration names and a stored selection must match. */
export const CONNECTOR_ID_PATTERN = /^[a-z0-9_]+$/;

/** What an operator may choose among: one registered adapter, described without its behaviour. */
export type ConnectorAdapterSummary = Readonly<{
  id: string;
  type: ConnectorType;
  supportsAsyncCallback: boolean;
  scope: ConnectorScope;
  callbackFields: readonly string[];
}>;

export { ConnectorRejectionReason, ConnectorExecutionResult };

export interface ConnectorExecutionPort {
  execute(
    declarations: readonly NormalizedWorkflowConnectorDeclaration[],
    context: Readonly<Record<string, unknown>>,
    execution: Readonly<{ onboardingId: string; stepName: string }>,
  ): Promise<ConnectorExecutionResult>;

  resume(
    declarations: readonly NormalizedWorkflowConnectorDeclaration[],
    context: Readonly<Record<string, unknown>>,
    execution: Readonly<{ onboardingId: string; stepName: string }>,
    completedConnectorOrder: number,
    resolvedResult: ConnectorExecutionResult,
  ): Promise<ConnectorExecutionResult>;

  findAdapterById?(
    connectorId: string,
  ): Required<Pick<ConnectorAdapter, 'id' | 'mapCallbackResult'>> & ConnectorAdapter;

  /** Every registered adapter, in registration order. */
  listAdapters?(): readonly ConnectorAdapterSummary[];

  validateDeclarations?(declarations: readonly NormalizedWorkflowConnectorDeclaration[]): void;
}
