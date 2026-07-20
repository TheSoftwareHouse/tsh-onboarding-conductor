export interface ConnectorAdapter {
  readonly name: string;
  readonly type: string;
  verify(payload: Readonly<Record<string, unknown>>): Promise<boolean>;
}

export const CONNECTOR_ADAPTER_COLLECTION = Symbol('CONNECTOR_ADAPTER_COLLECTION');

export type ConnectorAdapterCollection = readonly ConnectorAdapter[];
