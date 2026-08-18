import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import type { WorkflowSourceKind } from '../../config/workflow-sources';
import {
  type ConnectorCallbackResult,
  ConnectorExecutionResult,
} from './connector-execution-result';

/**
 * Identifies the running workflow step. `workflowSource` is what lets a connector resolve
 * source-scoped assets — an email template, say — without one source reaching into another's.
 */
export type ConnectorExecutionContext = Readonly<{
  onboardingId: string;
  stepName: string;
  workflowSource: WorkflowSourceKind;
}>;

export type ConnectorExecutionInput = {
  readonly declaration: Readonly<{
    order: number;
    config: Readonly<Record<string, unknown>>;
  }>;
  readonly execution: ConnectorExecutionContext;
  readonly context: Readonly<Record<string, unknown>>;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadFieldSources: Readonly<Record<string, string>>;
};

export type ConnectorCallbackMappingInput = {
  readonly rawBody: Uint8Array;
  readonly headers: Readonly<Record<string, string | undefined>>;
};

export const ConnectorTier = {
  /** Talks to a real provider. Safe to register in any environment. */
  PRODUCTION: 'production',
  /** Fakes its provider. Local development and testing only — never registered in production. */
  SANDBOX: 'sandbox',
} as const;

export type ConnectorTier = (typeof ConnectorTier)[keyof typeof ConnectorTier];

export interface ConnectorAdapter {
  readonly name: string;
  readonly type: string;
  /**
   * Required and deliberately non-optional: adding a connector forces a choice about whether it
   * may run in production. See ConnectorsModule for how the tier gates registration.
   */
  readonly tier: ConnectorTier;
  readonly supportsAsyncCallback?: boolean;
  validateDeclaration?(declaration: NormalizedWorkflowConnectorDeclaration): void;
  execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult>;
  mapCallbackResult?(input: ConnectorCallbackMappingInput): Promise<ConnectorCallbackResult>;
}

export const CONNECTOR_ADAPTER_COLLECTION = Symbol('CONNECTOR_ADAPTER_COLLECTION');

export type ConnectorAdapterCollection = readonly ConnectorAdapter[];
