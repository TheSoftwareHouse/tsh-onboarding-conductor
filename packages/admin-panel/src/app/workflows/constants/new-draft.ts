export const MIN_DRAFT_VERSION = 1;
/** The engine stores `version` in a Postgres `integer`. */
export const MAX_DRAFT_VERSION = 2_147_483_647;
/** The width of `workflows.key`, which the engine enforces on `id`. */
export const MAX_WORKFLOW_ID_LENGTH = 100;
