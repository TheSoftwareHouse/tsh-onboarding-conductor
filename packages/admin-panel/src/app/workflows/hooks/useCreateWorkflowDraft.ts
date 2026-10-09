import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  createWorkflowDraft,
  type WorkflowDocumentInput,
  type WorkflowDraft,
  type WorkflowDraftError,
} from '@/api/workflows/workflow-drafts';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { ADMIN_ROUTES } from '@/constants/routes';
import { describeDraftError } from '../utils/describe-draft-error';

/** Creates a draft, then opens it in the editor. */
export function useCreateWorkflowDraft(): UseMutationResult<
  WorkflowDraft,
  WorkflowDraftError,
  WorkflowDocumentInput
> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation<WorkflowDraft, WorkflowDraftError, WorkflowDocumentInput>({
    mutationFn: createWorkflowDraft,
    onSuccess: ({ workflowId, version }) => {
      void queryClient.invalidateQueries({ queryKey: workflowQueries.lists() });
      void queryClient.invalidateQueries({
        queryKey: workflowQueries.versions(workflowId).queryKey,
      });
      // A visit before the draft existed may have cached a 404 for it.
      void queryClient.invalidateQueries({
        queryKey: workflowQueries.detail(workflowId, version).queryKey,
      });
      showSuccessToast('Draft created');
      void navigate(`${ADMIN_ROUTES.workflows.details(workflowId)}?version=${version}`);
    },
    onError: (error) => {
      showErrorToast('Could not create the draft', describeDraftError(error));
    },
  });
}
