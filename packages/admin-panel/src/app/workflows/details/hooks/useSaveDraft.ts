import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  updateWorkflowDraft,
  type WorkflowDocumentInput,
  type WorkflowDraft,
  type WorkflowDraftError,
} from '@/api/workflows/workflow-drafts';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { ADMIN_ROUTES } from '@/constants/routes';
import { describeDraftError } from '../../utils/describe-draft-error';
import { hasOtherVersions, removeVersion } from '../utils/draft-cache';

/** Replaces the draft; a document carrying a new `id` or `version` moves it, and the page follows. */
export function useSaveDraft(
  workflowId: string,
  version: number,
): UseMutationResult<WorkflowDraft, WorkflowDraftError, WorkflowDocumentInput> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation<WorkflowDraft, WorkflowDraftError, WorkflowDocumentInput>({
    mutationFn: (document) => updateWorkflowDraft(workflowId, version, document),
    onSuccess: async (draft) => {
      showSuccessToast('Draft saved.');
      void queryClient.invalidateQueries({ queryKey: workflowQueries.lists() });

      if (draft.workflowId === workflowId && draft.version === version) {
        // Awaited so the caller settles its text against the refetched document.
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: workflowQueries.detail(workflowId, version).queryKey,
          }),
          queryClient.invalidateQueries({
            queryKey: workflowQueries.versions(workflowId).queryKey,
          }),
        ]);
        return;
      }

      const oldFamilyRemains =
        draft.workflowId === workflowId || hasOtherVersions(queryClient, workflowId, version);
      // Started before navigating, so the new page holds its definition read until the list knows the draft.
      if (oldFamilyRemains) {
        void queryClient.invalidateQueries({
          queryKey: workflowQueries.versions(workflowId).queryKey,
        });
      }
      void queryClient.invalidateQueries({
        queryKey: workflowQueries.versions(draft.workflowId).queryKey,
      });
      void queryClient.invalidateQueries({
        queryKey: workflowQueries.detail(draft.workflowId, draft.version).queryKey,
      });
      const movedTo = `${ADMIN_ROUTES.workflows.details(draft.workflowId)}?version=${draft.version}`;
      void navigate(movedTo, { replace: true });
      // In the same tick as navigating: an editor render in between would refetch the removed version into a 404.
      removeVersion(queryClient, workflowId, version, oldFamilyRemains);
    },
    onError: (error) => showErrorToast('Unable to save the draft:', describeDraftError(error)),
  });
}
