import type { WorkflowFieldTypeAlias, WorkflowFieldTypeName } from './fields/field-type.registry';
import type { WorkflowFieldFormat } from './formats/field-format.registry';
import type { NormalizedWorkflowCondition, RawWorkflowCondition } from './workflow-condition';

export type { WorkflowFieldFormat } from './formats/field-format.registry';

export const WORKFLOW_STATUSES = [
  'awaiting_user',
  'awaiting_manual_review',
  'approved',
  'rejected',
  'invalid',
] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

/**
 * What a connector does, named by capability rather than by provider: `sendgrid_email` and `smtp`
 * are both `email_delivery`. It is the axis an operator groups connectors along, so two providers
 * of the same kind must share a value and a new provider joins an existing one.
 *
 * The set is capability-only on purpose. A market segment (B2C against B2B) is a property of the
 * onboarding rather than of the connector — the same identity check serves both — so it does not
 * belong here. `custom` covers a connector with no capability of its own, which is what makes the
 * generic `http_request` connector expressible at all.
 */
export const CONNECTOR_TYPES = [
  // Identity and compliance.
  'kyc',
  'kyb',
  'aml',
  'credit',
  // Reaching, and proving, a contact channel.
  'phone_verification',
  'email_verification',
  'email_delivery',
  'sms_delivery',
  // Instruments and agreements.
  'bank_verification',
  'payment',
  'e_signature',
  'document_storage',
  // No capability of its own.
  'custom',
] as const;

export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export type WorkflowTransitionStatus =
  'success' | 'rejected' | 'manual.approve' | 'manual.reject' | 'manual.invalid';

export type WorkflowManualTransitionStatus = Extract<WorkflowTransitionStatus, `manual.${string}`>;

/** Derived from the field-type registry: adding a type does not require an edit here. */
export type WorkflowFieldType = WorkflowFieldTypeName;
export type LegacyWorkflowFieldType = WorkflowFieldTypeAlias;

type DeclaredFieldType = WorkflowFieldTypeName | WorkflowFieldTypeAlias;

export type TextValidation = {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: WorkflowFieldFormat;
  oneOf?: readonly string[];
  manyOf?: readonly string[];
};

export type NumberValidation = {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  oneOf?: readonly number[];
  manyOf?: readonly number[];
};

export type BooleanValidation = {
  oneOf?: readonly boolean[];
};

export type DateValidation = {
  oneOf?: readonly string[];
  manyOf?: readonly string[];
};

export type FileValidation = {
  contentTypes: readonly string[];
  maxSizeBytes: number;
  maxImageWidth?: number;
  maxImageHeight?: number;
};

export type ArrayValidation = {
  minItems?: number;
  maxItems?: number;
};

/**
 * Field descriptors are open envelopes: everything common to all types lives here, everything
 * type-specific lives in the field-type module that owns it.
 */
export type RawWorkflowField = {
  type: DeclaredFieldType;
  required: boolean;
  persist?: boolean;
  when?: RawWorkflowCondition;
};

export type RawWorkflowNestedField = {
  type: DeclaredFieldType;
  required: boolean;
  when?: RawWorkflowCondition;
};

export type RawWorkflowArrayItemField = {
  type: DeclaredFieldType;
};

export type RawWorkflowTransition = {
  status: WorkflowTransitionStatus;
  target?: string;
  when?: RawWorkflowCondition;
  webhook?: RawWorkflowTransitionWebhookDeclaration;
};

/**
 * Bounds a declared `retry` must fall inside. Hard limits rather than guidance: the connector
 * chain runs inside the onboarding submit's transaction, so every millisecond declared here is a
 * pooled database connection held open while nothing happens.
 */
export const CONNECTOR_RETRY_BOUNDS = {
  minAttempts: 1,
  maxAttempts: 5,
  minDelayMs: 0,
  maxDelayMs: 5000,
} as const;

/** Fallback entries one declaration may chain behind it. */
export const MAX_CONNECTOR_FALLBACK_CHAIN_LENGTH = 3;

export type RawWorkflowConnectorRetryDeclaration = {
  maxAttempts?: number;
  delayMs?: number;
};

export type NormalizedWorkflowConnectorRetry = {
  /** Total attempts this declaration gets, the first one included. `1` means no retries. */
  maxAttempts: number;
  /** How long the executor waits between two attempts at this declaration. */
  delayMs: number;
};

/** The policy a declaration naming no `retry` gets: one retry, waited for no time at all. */
export const DEFAULT_CONNECTOR_RETRY: NormalizedWorkflowConnectorRetry = {
  maxAttempts: 2,
  delayMs: 0,
};

/**
 * A fallback shares the primary's `order`, `async` and `canReject` — they describe the step's
 * slot, not the provider filling it — so none of them, and no `errorHandler` of its own, is
 * declared here. One failure policy governs the slot, every fallback in its chain included.
 *
 * `retry` is the exception, and the reason it is declared here at all: how many attempts a
 * provider is worth, and how long waiting for it is worth, is a property of that provider rather
 * than of the slot. It overrides the primary's resolved policy field-wise, so an entry naming only
 * `maxAttempts` keeps the primary's interval.
 */
export type RawWorkflowConnectorFallbackDeclaration = {
  name: string;
  id: string;
  type: ConnectorType;
  fieldMapping?: Record<string, string>;
  config?: Record<string, unknown>;
  retry?: RawWorkflowConnectorRetryDeclaration;
};

export type RawWorkflowConnectorDeclaration = {
  name: string;
  /** The adapter this declaration invokes, matched against `ConnectorAdapter.id`. */
  id: string;
  /** The adapter's capability. Declared here too so a workflow document classifies itself. */
  type: ConnectorType;
  canReject?: boolean;
  async?: boolean;
  order: number;
  fieldMapping: Record<string, string>;
  config?: Record<string, unknown>;
  /** The `ConnectorErrorHandler.id` deciding what happens when this connector's adapter throws. Defaults to `fallback_on_error` when omitted. */
  errorHandler?: string;
  /** Attempts and interval this connector gets. Defaults to `DEFAULT_CONNECTOR_RETRY` when omitted. */
  retry?: RawWorkflowConnectorRetryDeclaration;
  /** Providers to try, in order, once this one has run out of attempts. */
  fallback?: RawWorkflowConnectorFallbackDeclaration[];
};

export const WorkflowWebhookEventType = {
  ONBOARDING_STATE_CHANGED: 'onboarding.state_changed',
} as const;

export type WorkflowWebhookEventType =
  (typeof WorkflowWebhookEventType)[keyof typeof WorkflowWebhookEventType];

export type RawWorkflowNotifyWebhookDeclaration = {
  path: string;
};

export type RawWorkflowRootWebhookDeclaration = {
  notify: RawWorkflowNotifyWebhookDeclaration;
};

export type RawWorkflowTransitionWebhookDeclaration = {
  notify: false;
};

export type RawWorkflowStep = {
  name: string;
  status: WorkflowStatus;
  data: Record<string, RawWorkflowField>;
  connectors?: RawWorkflowConnectorDeclaration[];
  transitions: RawWorkflowTransition[];
};

export type RawWorkflowDefinition = {
  id: string;
  version: number;
  name: string;
  initial?: string;
  webhook?: RawWorkflowRootWebhookDeclaration;
  steps: RawWorkflowStep[];
};

export type NormalizedWorkflowField = {
  type: WorkflowFieldTypeName;
  required: boolean;
  persist: boolean;
  when?: NormalizedWorkflowCondition;
};

export type NormalizedWorkflowNestedField = {
  type: WorkflowFieldTypeName;
  required: boolean;
};

export type NormalizedWorkflowArrayItemField = {
  type: WorkflowFieldTypeName;
};

export type NormalizedWorkflowTransition = {
  status: WorkflowTransitionStatus;
  target?: string;
  when?: NormalizedWorkflowCondition;
  webhook?: NormalizedWorkflowTransitionWebhookDeclaration;
};

export type NormalizedWorkflowConnectorDeclaration = {
  name: string;
  id: string;
  type: ConnectorType;
  canReject: boolean;
  async: boolean;
  order: number;
  fieldMapping: Readonly<Record<string, string>>;
  config: Readonly<Record<string, unknown>>;
  errorHandler?: string;
  retry: NormalizedWorkflowConnectorRetry;
  /** The chain behind this connector, in declared order. Empty when none was declared. */
  fallbacks: readonly NormalizedWorkflowConnectorFallback[];
};

/**
 * A fallback is a full declaration minus `fallbacks` and `errorHandler`: it is usable everywhere a
 * declaration is, while the `Omit` keeps the chain flat and one failure policy per slot. Its own
 * `retry` survives the `Omit`, because that is the one policy a chain entry decides for itself.
 */
export type NormalizedWorkflowConnectorFallback = Omit<
  NormalizedWorkflowConnectorDeclaration,
  'fallbacks' | 'errorHandler'
>;

export type NormalizedWorkflowNotifyWebhookDeclaration = {
  path: string;
};

export type NormalizedWorkflowRootWebhookDeclaration = {
  notify: NormalizedWorkflowNotifyWebhookDeclaration;
};

export type NormalizedWorkflowTransitionWebhookDeclaration = {
  notify: false;
};

export type NormalizedWorkflowStep = {
  name: string;
  status: WorkflowStatus;
  data: Readonly<Record<string, NormalizedWorkflowField>>;
  connectors: readonly NormalizedWorkflowConnectorDeclaration[];
  transitions: readonly NormalizedWorkflowTransition[];
  terminal: boolean;
};

export type NormalizedWorkflowDefinition = {
  id: string;
  version: number;
  name: string;
  initial: string;
  webhook?: NormalizedWorkflowRootWebhookDeclaration;
  steps: readonly NormalizedWorkflowStep[];
  stepsByName: Readonly<Record<string, NormalizedWorkflowStep>>;
};
