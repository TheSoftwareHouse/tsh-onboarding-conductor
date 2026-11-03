import { MILLISECONDS_PER_MINUTE } from '../../time.constants';

/** Pages read per audit query or list; a window with more rows is reported `truncated`. */
export const MAX_PAGES_PER_QUERY = 50;

/** How long the masked rows of one export are reused for the same caller and filters. */
export const EXPORT_ROWS_TTL_MS = 5 * MILLISECONDS_PER_MINUTE;
/** Exports held in memory at once, across callers; the oldest goes first. */
export const MAX_CACHED_EXPORTS = 20;
/** Rows read from one export; the rest is left unread and the result reported `truncated`. */
export const MAX_EXPORT_ROWS = 100_000;

/** Rows of the review queue returned in one call, oldest first. */
export const MAX_QUEUE_ITEMS = 200;

/** The group a row lands in when the grouped column is empty or was not exported for it. */
export const NO_VALUE_GROUP = '(none)';

/** Audit actions the funnel reads: every one writes the step an onboarding left and entered. */
export const FUNNEL_AUDIT_ACTIONS = [
  'onboarding.started',
  'onboarding.state_transition',
  'onboarding.manual_review_decision',
] as const;
export const ONBOARDING_STARTED_ACTION = 'onboarding.started';
