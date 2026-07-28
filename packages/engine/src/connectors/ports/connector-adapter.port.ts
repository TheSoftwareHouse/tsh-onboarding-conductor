import {
  type ConnectorCallbackResult,
  ConnectorExecutionResult,
} from './connector-execution-result';

export type ConnectorExecutionInput = {
  readonly declaration: Readonly<{
    config: Readonly<Record<string, unknown>>;
  }>;
  readonly execution: Readonly<{ onboardingId: string; stepName: string }>;
  readonly context: Readonly<Record<string, unknown>>;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadFieldSources: Readonly<Record<string, string>>;
};

export type ConnectorCallbackMappingInput = {
  readonly providerKey: string;
  readonly connectorType: string;
  readonly rawBody: Uint8Array;
  readonly headers: Readonly<Record<string, string | undefined>>;
};

export interface ConnectorAdapter {
  readonly name: string;
  readonly type: string;
  readonly supportsAsyncCallback?: boolean;
  execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult>;
  mapCallbackResult?(input: ConnectorCallbackMappingInput): Promise<ConnectorCallbackResult>;
}

export const CONNECTOR_ADAPTER_COLLECTION = Symbol('CONNECTOR_ADAPTER_COLLECTION');

export type ConnectorAdapterCollection = readonly ConnectorAdapter[];
