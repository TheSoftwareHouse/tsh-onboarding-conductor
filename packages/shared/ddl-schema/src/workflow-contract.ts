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

/** The statuses an onboarding ends in. A step carrying one declares no data and no transitions. */
export const TERMINAL_WORKFLOW_STATUSES = [
  'approved',
  'rejected',
  'invalid',
] as const satisfies readonly WorkflowStatus[];

export type TerminalWorkflowStatus = (typeof TERMINAL_WORKFLOW_STATUSES)[number];

/**
 * Names a document may not use for a step, a field, a port or a score: every member of
 * `Object.prototype`. A plain-object lookup by one of these finds the prototype's member instead of
 * "nothing" — a field called `toString` fails today with a misleading `DUPLICATE_FIELD_NAME` — and
 * an assignment under `__proto__` rewrites the object's prototype outright. Several maps in the
 * engine and this package are keyed by these names; refusing them at the schema is cheaper than
 * auditing every lookup. Derived rather than listed, so the set is whatever the runtime's is.
 */
export const UNSAFE_NAMES: readonly string[] = Object.getOwnPropertyNames(Object.prototype).sort();

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

/**
 * Why a connector refused. Declared here rather than in the engine because a workflow document
 * names these values on a `rejected` transition, so the schema has to know them.
 *
 * The distinction the vocabulary exists to draw: `CHALLENGE_EXPIRED` and `CHALLENGE_NOT_FOUND` say
 * the attempt went stale, not that the person was refused, and a workflow may route them back into
 * the flow. `CONNECTOR_REJECTED` is a refusal and `ATTEMPTS_EXHAUSTED` is an abuse signal; a
 * document that wants to recover from either has to say so explicitly.
 */
export const CONNECTOR_REJECTION_REASONS = [
  'ATTEMPTS_EXHAUSTED',
  'CHALLENGE_EXPIRED',
  'CHALLENGE_NOT_FOUND',
  'CONNECTOR_REJECTED',
] as const;

export type ConnectorRejectionReason = (typeof CONNECTOR_REJECTION_REASONS)[number];

/**
 * What an identity check concluded. Declared here rather than in the engine for the same reason
 * `CONNECTOR_REJECTION_REASONS` is: the adapter reports the outcome and the workflow document does
 * all the routing on it (`docs/decisions/0005-kyc-connector-outcome-contract.md`), so the schema
 * has to know the vocabulary, and there must be exactly one declaration of it.
 */
export const KYC_OUTCOMES = ['verified', 'human_review', 'retry', 'refused'] as const;

export type KycOutcome = (typeof KYC_OUTCOMES)[number];

/**
 * The outcomes a credit assessment connector reports, routed on by the `credit-assessment` step's
 * ports (`docs/decisions/0045-credit-assessment-kernel-algoan-first-provider.md`). Declared here
 * for the same reason as `KYC_OUTCOMES`: a workflow document routes on the vocabulary.
 */
export const CREDIT_OUTCOMES = ['approved', 'review', 'declined', 'retry'] as const;

export type CreditOutcome = (typeof CREDIT_OUTCOMES)[number];

/**
 * The document sets a `retry` outcome can reset. Exactly one is named per retry, and the workflow
 * routes the applicant back to the step that produced it.
 */
export const KYC_RETRY_TARGETS = ['IDENTITY', 'SELFIE', 'APPLICANT_DATA', 'QUESTIONNAIRE'] as const;

export type KycRetryTarget = (typeof KYC_RETRY_TARGETS)[number];

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
  /**
   * Bounds on the whole years between the submitted date and the day it is submitted, which is
   * how an eligibility rule such as "at least 18" is stated: an absolute cut-off date would be
   * correct only on the day it was written.
   */
  minAgeYears?: number;
  maxAgeYears?: number;
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
  /** Root-only. True makes the field's value readable through the public `/state` once the step has passed. */
  clientVisible?: boolean;
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
  /** `rejected` only: the refusal reasons this arm claims. Absent means "any reason". */
  reason?: readonly ConnectorRejectionReason[];
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
  optionalFieldMapping?: Record<string, string>;
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
  /**
   * Sources that may legitimately be absent — a field whose `when` did not hold. They are omitted
   * from the connector payload instead of failing the step, which is the only way a workflow can
   * offer a choice of document and still hand every branch to one connector declaration.
   */
  optionalFieldMapping?: Record<string, string>;
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
  ONBOARDING_AGREEMENT_PENDING: 'onboarding.agreement_pending',
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

/**
 * The comparators legal on a score condition leaf. Four ordered comparators only — no `equals`,
 * because a score is the result of accumulated arithmetic, so banding is what a document actually
 * wants and exact equality on a computed integer is a trap rather than a feature. Declared once so
 * the schema builder and the normalizer both read this array instead of repeating the literals.
 */
export const WORKFLOW_SCORE_COMPARATORS = ['gte', 'gt', 'lte', 'lt'] as const;

export type WorkflowScoreComparator = (typeof WORKFLOW_SCORE_COMPARATORS)[number];

export type RawWorkflowScoreDeclaration = { min: number; max: number };

export type NormalizedWorkflowScore = { name: string; min: number; max: number };

export type RawWorkflowScoringRule = {
  score: string;
  when?: RawWorkflowCondition;
  add: number;
};

export type NormalizedWorkflowScoringRule = {
  score: string;
  when?: NormalizedWorkflowCondition;
  add: number;
};

/**
 * A field fragment merged into the including step's compiled entry step. Only a step type marked
 * `composable` may appear here.
 */
export type RawWorkflowStepInclude = {
  type: string;
  config?: Record<string, unknown>;
};

/**
 * One arm of a conditional edge. Arms are tried in order; an arm with no `when` is the fallback and
 * must come last, mirroring the rule the compiled form applies to a status group.
 */
export type RawWorkflowStepEdgeArm = {
  when?: RawWorkflowCondition;
  target: string;
  /**
   * `{ notify: false }` keeps the outbound client notification from firing on this arm alone. It
   * is the compiled form's per-transition opt-out, reachable from every port of every type, because
   * whether a move is worth telling the client about is a property of the edge, not of the step.
   */
  webhook?: RawWorkflowTransitionWebhookDeclaration;
};

/**
 * Where a port leads: a step name, or arms that pick the step by condition. The conditional form is
 * what lets a canvas draw a fork out of one outcome without an author reaching for a `decision`
 * step — and its extra round trip — to split it.
 */
export type RawWorkflowStepEdge = string | RawWorkflowStepEdgeArm[];

/**
 * Free-form authoring metadata — a title, a description, a canvas position. The compiler never
 * reads it; it is carried so a builder has somewhere to keep what it needs, since the stored
 * document is the authored one and there is no other place to keep layout.
 */
export type RawWorkflowMeta = Record<string, unknown>;

/**
 * An agreement family a workflow collects acceptance for. The document names the family only: which
 * version is owed is the engine's to resolve, so a version here would go stale on the next publish.
 * It is declared at the root, so the step collecting the acceptance is named rather than implied by
 * where the declaration sits.
 */
export type RawWorkflowAgreementDeclaration = {
  key: string;
  /** The step whose submit collects the acceptance. */
  step: string;
  /** That step's own persisted boolean field whose `true` marks the family accepted. */
  acceptedWhen: string;
};

/**
 * One step as an author writes it: an instance of a step type. It compiles to one or more of the
 * runtime steps below — one for most types, named after this step; several for a type such as
 * `otp-verify`, whose extra steps are called `<step>_<key>` unless `substeps` renames them.
 */
export type RawWorkflowStep = {
  name: string;
  /** The step type this step instantiates, matched against `WorkflowStepTypeDefinition.type`. */
  type: string;
  config?: Record<string, unknown>;
  /**
   * Fragments whose fields join this step's compiled entry step, after the step type's own fields
   * and in declared order. This is how one screen collects an identity, an address and a bespoke
   * field without three round trips.
   */
  include?: RawWorkflowStepInclude[];
  /**
   * Renames a generated sub-step, keyed by the sub-step key its step type declares. Compiled step
   * names are client-visible — a client renders per step — so a document migrating from untyped
   * steps keeps its names rather than forcing every caller to change.
   */
  substeps?: Record<string, string>;
  /** Where each output port leads. */
  edges?: Record<string, RawWorkflowStepEdge>;
  /**
   * Scoring rules this step contributes, evaluated on the submit of the compiled step its type
   * names for them — the entry step unless the type says otherwise (`otp-verify` scores on the
   * check, since that is where the outcome is known). Any step with a submit may score; `terminal`
   * has none, and `risk-score` carries its rules in config, so both refuse this.
   */
  scoring?: RawWorkflowScoringRule[];
  meta?: RawWorkflowMeta;
};

/**
 * The authored form of a workflow: typed steps wired together by their ports. It is the only form a
 * document may be written in — `compileWorkflow` turns it into the compiled form the engine runs,
 * which is validated as the compiled intermediate and never authored directly.
 */
export type RawWorkflowDefinition = {
  id: string;
  version: number;
  /** A display label for the workflow. Optional; `id` is the identifier. */
  name?: string;

  /** The step the onboarding starts on. Defaults to the first step. */
  initial?: string;
  webhook?: RawWorkflowRootWebhookDeclaration;
  scoring?: Record<string, RawWorkflowScoreDeclaration>;
  /**
   * The agreement families this workflow collects acceptance for. A family belongs to the workflow
   * rather than to the screen that happens to carry its checkbox, so it is declared here once and
   * names the step whose submit observes it.
   */
  agreements?: RawWorkflowAgreementDeclaration[];
  meta?: RawWorkflowMeta;
  steps: RawWorkflowStep[];
};

/**
 * One step as the engine runs it: what every step type compiles to. A document written in this
 * shape is an untyped step list — the form workflows were authored in before step types — and is
 * refused as input; `convertUntypedSteps` lifts it into `custom` steps.
 */
export type CompiledWorkflowStep = {
  name: string;
  status: WorkflowStatus;
  data: Record<string, RawWorkflowField>;
  connectors?: RawWorkflowConnectorDeclaration[];
  transitions: RawWorkflowTransition[];
  scoring?: RawWorkflowScoringRule[];
};

/** The compiled form of a workflow: the document the compiled schema, the normalizer and the engine see. */
export type CompiledWorkflowDefinition = {
  id: string;
  version: number;
  name?: string;

  initial?: string;
  webhook?: RawWorkflowRootWebhookDeclaration;
  steps: CompiledWorkflowStep[];
  scoring?: Record<string, RawWorkflowScoreDeclaration>;
  /** Carried through the compile unchanged, except that `step` names the compiled entry step. */
  agreements?: RawWorkflowAgreementDeclaration[];
};

export type NormalizedWorkflowField = {
  type: WorkflowFieldTypeName;
  required: boolean;
  persist: boolean;
  /** Present only when true; absent means the client never sees the value. */
  clientVisible?: true;
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
  reason?: readonly ConnectorRejectionReason[];
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
  optionalFieldMapping: Readonly<Record<string, string>>;
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

export type NormalizedWorkflowAgreementDeclaration = {
  key: string;
  step: string;
  acceptedWhen: string;
};

export type NormalizedWorkflowStep = {
  name: string;
  status: WorkflowStatus;
  data: Readonly<Record<string, NormalizedWorkflowField>>;
  connectors: readonly NormalizedWorkflowConnectorDeclaration[];
  transitions: readonly NormalizedWorkflowTransition[];
  terminal: boolean;
  scoring: readonly NormalizedWorkflowScoringRule[];
};

export type NormalizedWorkflowDefinition = {
  id: string;
  version: number;
  /** The document's display label, when it declares one. */
  name?: string;

  initial: string;
  webhook?: NormalizedWorkflowRootWebhookDeclaration;
  steps: readonly NormalizedWorkflowStep[];
  stepsByName: Readonly<Record<string, NormalizedWorkflowStep>>;
  scores: Readonly<Record<string, NormalizedWorkflowScore>>;
  /** Empty on a workflow declaring none, so every consumer reads one shape. */
  agreements: readonly NormalizedWorkflowAgreementDeclaration[];
};
