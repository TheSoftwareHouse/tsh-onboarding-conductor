import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';

export const WORKFLOW_CONNECTOR_EXECUTION_PORT = Symbol('WORKFLOW_CONNECTOR_EXECUTION_PORT');

export interface ConnectorExecutionPort {
  execute(
    declarations: readonly NormalizedWorkflowConnectorDeclaration[],
    context: Readonly<Record<string, unknown>>,
    execution: Readonly<{ onboardingId: string; stepName: string }>,
  ): Promise<boolean>;
}
