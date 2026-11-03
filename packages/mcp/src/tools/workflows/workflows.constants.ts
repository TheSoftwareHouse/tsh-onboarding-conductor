/** The names the model calls the workflow tools by. */
export const WorkflowToolName = {
  LIST: 'list_workflows',
  GET_VERSION: 'get_workflow_version',
  GET_DOCUMENT: 'get_workflow_document',
  DIFF_VERSIONS: 'diff_workflow_versions',
  COMPILE: 'compile_workflow',
  CREATE_DRAFT: 'create_workflow_draft',
} as const;

/** Error codes the engine's workflow routes answer with. */
export const WorkflowErrorCode = {
  DRAFT_EXISTS: 'WORKFLOW_DRAFT_EXISTS',
  VERSION_EXISTS: 'WORKFLOW_VERSION_EXISTS',
  SCOPE_CONFLICT: 'WORKFLOW_SCOPE_CONFLICT',
  INVALID: 'WORKFLOW_INVALID',
} as const;

/** The scope a draft can be written to; a family in any other scope refuses one. */
export const DRAFT_FAMILY_SCOPE = 'users';

/** Pages of the workflow list read before the answer is marked truncated. */
export const MAX_WORKFLOW_PAGES = 10;

/** The bounds the engine puts on a workflow's display name. */
export const MAX_WORKFLOW_NAME_LENGTH = 200;

/** The adapter id of the generic HTTP connector, whose request headers can carry credentials. */
export const HTTP_REQUEST_ADAPTER_ID = 'http_request';

/** The typed step that always calls the HTTP connector, with or without a connector binding. */
export const HTTP_CALL_STEP_TYPE = 'http-call';

/** What a literal header value is replaced with. */
export const REDACTED_VALUE = '[redacted]';
