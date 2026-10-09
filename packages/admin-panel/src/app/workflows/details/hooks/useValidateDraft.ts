import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import {
  compileWorkflowDocument,
  type WorkflowCompilation,
  type WorkflowDocumentInput,
  type WorkflowDraftError,
} from '@/api/workflows/workflow-drafts';

/** Dry-runs the engine's compiler over the editor's document; nothing is stored, so the outcome is the caller's to show. */
export function useValidateDraft(): UseMutationResult<
  WorkflowCompilation,
  WorkflowDraftError,
  WorkflowDocumentInput
> {
  return useMutation<WorkflowCompilation, WorkflowDraftError, WorkflowDocumentInput>({
    mutationFn: compileWorkflowDocument,
  });
}
