import type { NormalizedWorkflowConnectorFallback, ConnectorType } from '@tsh/ddl-schema';
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

export type ConnectorReconcileInput = Readonly<{ onboardingId: string }>;

/**
 * What an adapter answers when the engine asks for a parked attempt's verdict rather than
 * waiting for the callback: nothing to apply yet, or the same result a callback would carry.
 */
export type ConnectorReconcileResult =
  | Readonly<{ outcome: 'still_pending' }>
  | Readonly<{ outcome: 'resolved'; callback: ConnectorCallbackResult }>;

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
  /**
   * The `settingsSchema` key holding the inbound signing secret. Defaults to
   * `callbackSigningSecret`; a provider that signs both directions with one secret names that
   * secret's key here.
   */
  secretSettingKey?: string;
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

export type ConnectorSettingDefinition = Readonly<{
  key: string;
  /** True when the value must never leave the engine — masked in every API response. */
  secret: boolean;
  required: boolean;
  /** Optional format constraint checked against a submitted value, when present. */
  pattern?: RegExp;
}>;

export type ConnectorSettingsSchema = Readonly<{
  fields: readonly ConnectorSettingDefinition[];
}>;

export interface ConnectorAdapter {
  readonly name: string;
  /**
   * The connector's unique identifier — `otp`, `smtp` — and the value a workflow
   * step's connector declaration names. Freely chosen per adapter, exactly as a workflow
   * chooses its own `id`.
   */
  readonly id: string;
  /**
   * What this connector does, from `CONNECTOR_TYPES`: `sendgrid_email` and `smtp` are both
   * `email_delivery`. It names a capability and never a provider, because it is the axis operators
   * group connectors along. The adapter is the authority — a workflow declaration that claims a
   * different capability for this id fails at startup.
   */
  readonly type: ConnectorType;
  readonly supportsAsyncCallback?: boolean;
  /** Required when `supportsAsyncCallback` is true; asserted at startup. */
  readonly callbackAuth?: ConnectorCallbackAuth;
  /**
   * The `submittedData` keys an async adapter's callback may emit. A step bound to the adapter
   * must declare every one of them in its `data`, or a verdict carrying one would be refused.
   */
  readonly callbackFields?: readonly string[];
  /** Absent when the connector is not configurable through the admin settings API. */
  readonly settingsSchema?: ConnectorSettingsSchema;
  validateDeclaration?(declaration: NormalizedWorkflowConnectorFallback): void;
  execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult>;
  mapCallbackResult?(input: ConnectorCallbackMappingInput): Promise<ConnectorCallbackResult>;
  /**
   * Reads the verdict of the attempt the onboarding is parked on back from the provider, for an
   * operator whose callback never arrived. Optional: a provider with no read-back cannot offer it.
   */
  reconcilePending?(input: ConnectorReconcileInput): Promise<ConnectorReconcileResult>;
}

export const CONNECTOR_ADAPTER_COLLECTION = Symbol('CONNECTOR_ADAPTER_COLLECTION');

export type ConnectorAdapterCollection = readonly ConnectorAdapter[];
