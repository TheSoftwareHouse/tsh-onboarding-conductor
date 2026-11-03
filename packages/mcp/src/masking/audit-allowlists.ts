/**
 * What an audit row may show, per action family. The engine's audit API returns `metadata` as
 * written — outbound webhook rows carry whole payloads — so the MCP names the keys it keeps and
 * drops the rest. Keys follow `packages/engine/src/audit/audit.types.ts`.
 */

/** A string, number, boolean or null. */
export const SCALAR = 'scalar';
/** An array of scalars. */
export const SCALAR_LIST = 'scalarList';
/** An object whose number values are kept (scores). */
export const NUMBER_MAP = 'numberMap';
/** An object of field name to reason codes; never the values the codes are about. */
export const CODE_MAP = 'codeMap';
/** An array of flat objects of scalars. */
export const SCALAR_RECORD_LIST = 'scalarRecordList';
/** An object masked by the onboarding's field classes. */
export const MASKED_DATA = 'maskedData';

export type MetadataRule =
  | typeof SCALAR
  | typeof SCALAR_LIST
  | typeof NUMBER_MAP
  | typeof CODE_MAP
  | typeof SCALAR_RECORD_LIST
  | typeof MASKED_DATA
  | { object: MetadataAllowlist };

export type MetadataAllowlist = Readonly<Record<string, MetadataRule>>;

const LIFECYCLE: MetadataAllowlist = {
  workflowId: SCALAR,
  workflowVersion: SCALAR,
  appliedStep: SCALAR,
  fromStatus: SCALAR,
  toStatus: SCALAR,
  fromCurrentStep: SCALAR,
  toCurrentStep: SCALAR,
  fromScores: NUMBER_MAP,
  toScores: NUMBER_MAP,
  manualTrigger: SCALAR,
};

const REJECTED_ATTEMPT: MetadataAllowlist = { operation: SCALAR, outcome: SCALAR };

/** The provider-side result of an applied callback or reconcile; its free-form `metadata` is left out. */
const CONNECTOR_EXECUTION_RESULT: MetadataAllowlist = {
  status: SCALAR,
  reason: SCALAR,
  errors: CODE_MAP,
  pending: {
    object: {
      connectorName: SCALAR,
      connectorId: SCALAR,
      connectorOrder: SCALAR,
      parkedAt: SCALAR,
    },
  },
};

const CALLBACK_APPLIED: MetadataAllowlist = {
  providerIdentity: SCALAR,
  connectorOrder: SCALAR,
  outcome: SCALAR,
  submittedData: MASKED_DATA,
  connectorExecutionResult: { object: CONNECTOR_EXECUTION_RESULT },
};

const RECONCILED: MetadataAllowlist = {
  connectorId: SCALAR,
  connectorOrder: SCALAR,
  providerIdentity: SCALAR,
  submittedData: MASKED_DATA,
  connectorExecutionResult: { object: CONNECTOR_EXECUTION_RESULT },
};

const RECONCILE_NOOP: MetadataAllowlist = {
  connectorId: SCALAR,
  connectorOrder: SCALAR,
  outcome: SCALAR,
};

const EXPORTED: MetadataAllowlist = {
  status: SCALAR,
  workflowId: SCALAR,
  workflowVersion: SCALAR,
  currentStep: SCALAR,
  onboardingId: SCALAR,
  agreementStatus: SCALAR,
  parked: SCALAR,
  pendingConnectorId: SCALAR,
  parkedBefore: SCALAR,
};

/** `webhook.*` rows other than an applied callback; `payload` and `headers` never pass. */
const WEBHOOK: MetadataAllowlist = {
  reason: SCALAR,
  outcome: SCALAR,
  eventType: SCALAR,
  operation: SCALAR,
  attempt: SCALAR,
  status: SCALAR,
  errorName: SCALAR,
  onboardingId: SCALAR,
  outboxId: SCALAR,
};

const ADMIN_ACCESS: MetadataAllowlist = {
  method: SCALAR,
  reason: SCALAR,
  tenantId: SCALAR,
  userPrincipalName: SCALAR,
  grantedRoles: SCALAR_LIST,
  requiredRoles: SCALAR_LIST,
};

const CONNECTOR_SETTINGS: MetadataAllowlist = { connectorId: SCALAR, keys: SCALAR_LIST };

const WORKFLOW_CONNECTOR_SELECTION: MetadataAllowlist = {
  workflowId: SCALAR,
  stepName: SCALAR,
  connectorId: SCALAR,
  scope: SCALAR,
  versions: SCALAR_RECORD_LIST,
  previousConnectorId: SCALAR,
};

/** `connector.failure_*` and the outcome rows share one list; each row simply lacks the other's keys. */
const CONNECTOR: MetadataAllowlist = {
  stepName: SCALAR,
  connectorId: SCALAR,
  connectorName: SCALAR,
  connectorOrder: SCALAR,
  errorHandler: SCALAR,
  attempt: SCALAR,
  status: SCALAR,
  errorName: SCALAR,
  fallbackConnectorId: SCALAR,
  fallbackConnectorName: SCALAR,
  fallbackPosition: SCALAR,
  retryDelayMs: SCALAR,
  override: SCALAR,
  reason: SCALAR,
  fieldErrors: CODE_MAP,
};

const API_FAILURE: MetadataAllowlist = {
  method: SCALAR,
  route: SCALAR,
  status: SCALAR,
  code: SCALAR,
  errorName: SCALAR,
  fieldErrors: CODE_MAP,
};

const AGREEMENT: MetadataAllowlist = {
  key: SCALAR,
  type: SCALAR,
  version: SCALAR,
  linkedOnboardings: SCALAR,
  agreementId: SCALAR,
  origin: SCALAR,
};

const WORKFLOW_DRAFT: MetadataAllowlist = {
  workflowId: SCALAR,
  version: SCALAR,
  previousWorkflowId: SCALAR,
  previousVersion: SCALAR,
};

const ENCRYPTION: MetadataAllowlist = {
  keyId: SCALAR,
  supersededKeyId: SCALAR,
  rowsMoved: SCALAR,
  onboardingId: SCALAR,
  reason: SCALAR,
  rotationInterval: SCALAR,
};

/** The onboarding snapshot kept in a row's `before` and `after`. */
export const SNAPSHOT_ALLOWLIST: MetadataAllowlist = {
  id: SCALAR,
  workflowId: SCALAR,
  workflowVersion: SCALAR,
  status: SCALAR,
  currentStep: SCALAR,
  scores: NUMBER_MAP,
};

/** Actions whose list differs from the rest of their prefix; checked before the prefixes. */
const ACTION_ALLOWLISTS: ReadonlyMap<string, MetadataAllowlist> = new Map([
  ['onboarding.started', LIFECYCLE],
  ['onboarding.state_transition', LIFECYCLE],
  ['onboarding.manual_review_decision', LIFECYCLE],
  ['onboarding.rejected_attempt', REJECTED_ATTEMPT],
  ['onboarding.pending_connector_reconciled', RECONCILED],
  ['onboarding.pending_connector_reconcile_noop', RECONCILE_NOOP],
  ['onboardings.exported', EXPORTED],
  ['webhook.inbound_callback_applied', CALLBACK_APPLIED],
]);

const PREFIX_ALLOWLISTS: ReadonlyArray<readonly [string, MetadataAllowlist]> = [
  ['webhook.', WEBHOOK],
  ['auth.', ADMIN_ACCESS],
  ['connector_settings.', CONNECTOR_SETTINGS],
  ['workflow.', WORKFLOW_CONNECTOR_SELECTION],
  ['connector.', CONNECTOR],
  ['api.', API_FAILURE],
  ['agreement.', AGREEMENT],
  ['workflow_draft.', WORKFLOW_DRAFT],
  ['encryption.', ENCRYPTION],
];

/** The keys an action's metadata may keep; an action no list names keeps none. */
export function findMetadataAllowlist(action: string): MetadataAllowlist | undefined {
  return (
    ACTION_ALLOWLISTS.get(action) ??
    PREFIX_ALLOWLISTS.find(([prefix]) => action.startsWith(prefix))?.[1]
  );
}
