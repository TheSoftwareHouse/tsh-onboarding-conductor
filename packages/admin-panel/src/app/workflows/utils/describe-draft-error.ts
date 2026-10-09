import type { WorkflowDraftError } from '@/api/workflows/workflow-drafts';
import { DRAFT_ERROR_MESSAGES } from '../constants/draft-messages';

/** The operator-facing text for a failed draft write: the code's own copy, plus where the engine located it. */
export function describeDraftError(error: WorkflowDraftError): string {
  if (error.code === null) {
    return error.message;
  }

  const location = [error.reason, error.path].filter((part) => part !== undefined).join(' at ');
  const base = DRAFT_ERROR_MESSAGES[error.code];

  return location === '' ? base : `${base} (${location})`;
}
