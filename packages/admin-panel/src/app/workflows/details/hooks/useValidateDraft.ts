import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { WorkflowCompilation, WorkflowDocumentInput } from '@/api/workflows/workflow-drafts';
import type { ApiError } from '@/services/api/api-error';
import { workflowMutations } from '@/api/workflows/workflow-mutations';

/** Dry-runs the engine's compiler over the editor's document; nothing is stored, so the outcome is the caller's to show. */
export function useValidateDraft(): UseMutationResult<
  WorkflowCompilation,
  ApiError,
  WorkflowDocumentInput
> {
  return useMutation(workflowMutations.compile());
}
