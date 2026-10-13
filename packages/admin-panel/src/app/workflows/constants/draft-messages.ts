import type { WorkflowDraftErrorCode } from '@/api/workflows/workflow-drafts';

/** What the operator reads for each refusal the engine names on a draft route. */
export const DRAFT_ERROR_MESSAGES: Record<WorkflowDraftErrorCode, string> = {
  WORKFLOW_VERSION_EXISTS: 'This workflow already has that version. Choose another version number.',
  WORKFLOW_DRAFT_EXISTS:
    'This workflow already has a draft. Open or delete it before starting another.',
  WORKFLOW_SCOPE_CONFLICT:
    'That id belongs to a built-in or fixture workflow. Choose a different workflow id.',
  WORKFLOW_DRAFT_IN_USE: 'Onboardings already use this draft, so it cannot be changed.',
  WORKFLOW_VERSION_NOT_DRAFT: 'This version is no longer a draft.',
  WORKFLOW_VERSION_NOT_LATEST:
    'A newer version of this workflow is already published. Renumber the draft above it.',
  WORKFLOW_INVALID: 'The document is not a valid workflow document.',
  WORKFLOW_CONNECTOR_DECLARATION_INVALID: 'A connector declaration in the document is invalid.',
  WORKFLOW_SOURCE_KEY_CONFLICT: 'Another workflow already uses one of this document’s source keys.',
  WORKFLOW_NOT_FOUND: 'This workflow no longer exists.',
};
