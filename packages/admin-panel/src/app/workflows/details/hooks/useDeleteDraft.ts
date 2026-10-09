import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { deleteWorkflowDraft, type WorkflowDraftError } from '@/api/workflows/workflow-drafts';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { ADMIN_ROUTES } from '@/constants/routes';
import { describeDraftError } from '../../utils/describe-draft-error';
import { hasOtherVersions, removeVersion } from '../utils/draft-cache';

/** Deletes the draft, then leaves for its family when other versions remain, else for the list. */
export function useDeleteDraft(
  workflowId: string,
  version: number,
): UseMutationResult<void, WorkflowDraftError, void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation<void, WorkflowDraftError, void>({
    mutationFn: () => deleteWorkflowDraft(workflowId, version),
    onSuccess: () => {
      const familyRemains = hasOtherVersions(queryClient, workflowId, version);
      showSuccessToast('Draft deleted.');
      void queryClient.invalidateQueries({ queryKey: workflowQueries.lists() });
      if (familyRemains) {
        void queryClient.invalidateQueries({
          queryKey: workflowQueries.versions(workflowId).queryKey,
        });
      }
      void navigate(
        familyRemains ? ADMIN_ROUTES.workflows.details(workflowId) : ADMIN_ROUTES.workflows.root,
        { replace: true },
      );
      // In the same tick as navigating: an editor render in between would refetch the removed version into a 404.
      removeVersion(queryClient, workflowId, version, familyRemains);
    },
    onError: (error) => showErrorToast('Unable to delete the draft:', describeDraftError(error)),
  });
}
