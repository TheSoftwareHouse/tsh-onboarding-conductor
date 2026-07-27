import type { WorkflowConnectorMethod } from '@tsh/ddl-schema';
import { ConnectorExecutionResult } from './connector-execution-result';

export type ConnectorVerificationInput = {
  readonly declaration: Readonly<{
    method: WorkflowConnectorMethod;
    config: Readonly<Record<string, unknown>>;
  }>;
  readonly execution: Readonly<{ onboardingId: string; stepName: string }>;
  readonly context: Readonly<Record<string, unknown>>;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadFieldSources: Readonly<Record<string, string>>;
};

export interface ConnectorAdapter {
  readonly name: string;
  readonly type: string;
  verify(input: ConnectorVerificationInput): Promise<ConnectorExecutionResult>;
}

export const CONNECTOR_ADAPTER_COLLECTION = Symbol('CONNECTOR_ADAPTER_COLLECTION');

export type ConnectorAdapterCollection = readonly ConnectorAdapter[];
