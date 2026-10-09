import { readDraftError } from '@/api/workflows/workflow-drafts';
import type { ApiError } from '@/services/api/api-error';
import { DRAFT_ERROR_MESSAGES } from '../constants/draft-messages';

/** The operator-facing text for a failed draft write: the code's own copy, plus where the engine located it. */
export function describeDraftError(error: ApiError): string {
  const draftError = readDraftError(error);
  if (draftError === null) {
    return error.message;
  }

  const location = [draftError.reason, draftError.path]
    .filter((part) => part !== undefined)
    .join(' at ');
  const base = DRAFT_ERROR_MESSAGES[draftError.code];

  return location === '' ? base : `${base} (${location})`;
}
