import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import {
  type ConnectorRejectionReason,
  ConnectorExecutionResult,
} from './connector-execution-result';

export const WORKFLOW_CONNECTOR_EXECUTION_PORT = Symbol('WORKFLOW_CONNECTOR_EXECUTION_PORT');

export { ConnectorRejectionReason, ConnectorExecutionResult };

export interface ConnectorExecutionPort {
  execute(
    declarations: readonly NormalizedWorkflowConnectorDeclaration[],
    context: Readonly<Record<string, unknown>>,
    execution: Readonly<{ onboardingId: string; stepName: string }>,
  ): Promise<ConnectorExecutionResult>;
}
