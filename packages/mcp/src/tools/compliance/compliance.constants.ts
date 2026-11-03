/** Pages one audit read walks before it stops and reports `truncated`. */
export const AUDIT_MAX_PAGES = 50;
/** Entries `search_audit` returns before it reports `truncated`. */
export const SEARCH_AUDIT_MAX_ENTRIES = 200;
/** Entries one action contributes to an `access_report` before the report names it truncated. */
export const ACCESS_REPORT_MAX_ENTRIES_PER_ACTION = 1000;
/** Individual exports an `access_report` lists; the count covers all of them. */
export const ACCESS_REPORT_EXPORT_LIST_LIMIT = 50;
/** Window of an `access_report` that names no start. */
export const ACCESS_REPORT_DEFAULT_WINDOW_DAYS = 30;

export const MAX_TYPE_LENGTH = 64;
export const MAX_FILTER_LENGTH = 255;

/*
 * The audit actions an access report reads. The engine filters by exact action name only, so the
 * report asks for each one rather than paging the whole trail, which onboarding rows dominate.
 * Source of truth: `packages/engine/src/audit/audit.types.ts` — add an action there, add it here.
 */
export const ACCESS_ACTIONS = [
  'auth.access_granted',
  'auth.token_rejected',
  'auth.role_missing',
  'auth.verification_unavailable',
  'auth.access_unauthenticated',
] as const;

export const ACCESS_GRANTED_ACTION = 'auth.access_granted';
export const ACCESS_UNAUTHENTICATED_ACTION = 'auth.access_unauthenticated';

export const EXPORT_ACTION = 'onboardings.exported';

export const CONFIGURATION_ACTIONS = [
  'workflow.connector_selected',
  'workflow.connector_selection_cleared',
  'workflow_draft.created',
  'workflow_draft.updated',
  'workflow_draft.deleted',
  'workflow_draft.published',
  'connector_settings.updated',
  'connector_settings.deleted',
  'encryption.enabled',
  'encryption.disabled',
  'encryption.key_added',
  'encryption.key_superseded',
  'encryption.rotation_schedule_changed',
  'encryption.reencryption_requested',
  'encryption.reencryption_started',
  'encryption.reencryption_completed',
  'encryption.reencryption_failed',
  'encryption.decryption_started',
  'encryption.decryption_completed',
  'encryption.decryption_failed',
  'agreement.version_published',
  'agreement.linked',
  'agreement.accepted',
] as const;
