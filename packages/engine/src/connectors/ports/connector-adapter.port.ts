import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import {
  type ConnectorCallbackResult,
  ConnectorExecutionResult,
} from './connector-execution-result';

export type ConnectorExecutionInput = {
  readonly declaration: Readonly<{
    order: number;
    config: Readonly<Record<string, unknown>>;
    /** True when the engine will park the step and wait for a callback with the verdict. */
    async?: boolean;
  }>;
  readonly execution: Readonly<{ onboardingId: string; stepName: string }>;
  readonly context: Readonly<Record<string, unknown>>;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadFieldSources: Readonly<Record<string, string>>;
};

export type ConnectorCallbackMappingInput = {
  readonly rawBody: Uint8Array;
  readonly headers: Readonly<Record<string, string | undefined>>;
};

export type ConnectorCallbackSignedMessageInput = {
  readonly rawBody: Uint8Array;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly timestamp?: string;
};

/**
 * Recipe a provider uses to sign its callbacks. The adapter owns the recipe; the
 * engine owns the verification, so no adapter implements its own comparison.
 */
export type ConnectorCallbackHmacAuth = Readonly<{
  kind: 'hmac';
  algorithm: 'sha256' | 'sha512';
  signatureHeader: string;
  encoding: 'base64' | 'hex';
  /** Epoch-seconds header folded into the signed message and bounded against replay. */
  timestamp?: Readonly<{ header: string; toleranceSeconds: number }>;
  /** Providers emit several values during secret rotation, for example `t=..,v1=..,v1=..`. */
  parseSignatureHeader?(headerValue: string): readonly string[];
  /** Defaults to the raw body, or `<timestamp>.<rawBody>` when a timestamp is declared. */
  buildSignedMessage?(input: ConnectorCallbackSignedMessageInput): Uint8Array;
}>;

export type ConnectorCallbackUnsignedAuth = Readonly<{
  kind: 'none';
  justification: string;
}>;

export type ConnectorCallbackAuth = ConnectorCallbackHmacAuth | ConnectorCallbackUnsignedAuth;

export interface ConnectorAdapter {
  readonly name: string;
  readonly type: string;
  readonly supportsAsyncCallback?: boolean;
  /** Required when `supportsAsyncCallback` is true; asserted at startup. */
  readonly callbackAuth?: ConnectorCallbackAuth;
  validateDeclaration?(declaration: NormalizedWorkflowConnectorDeclaration): void;
  execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult>;
  mapCallbackResult?(input: ConnectorCallbackMappingInput): Promise<ConnectorCallbackResult>;
}

export const CONNECTOR_ADAPTER_COLLECTION = Symbol('CONNECTOR_ADAPTER_COLLECTION');

export type ConnectorAdapterCollection = readonly ConnectorAdapter[];
