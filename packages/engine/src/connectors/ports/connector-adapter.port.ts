export type ConnectorVerificationInput = {
  readonly context: Readonly<Record<string, unknown>>;
  readonly payload: Readonly<Record<string, unknown>>;
};

export interface ConnectorAdapter {
  readonly name: string;
  readonly type: string;
  verify(input: ConnectorVerificationInput): Promise<boolean>;
}

export const CONNECTOR_ADAPTER_COLLECTION = Symbol('CONNECTOR_ADAPTER_COLLECTION');

export type ConnectorAdapterCollection = readonly ConnectorAdapter[];
