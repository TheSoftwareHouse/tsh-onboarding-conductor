import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { type WorkflowDocumentInput, type WorkflowDraft } from '@/api/workflows/workflow-drafts';
import { workflowMutations } from '@/api/workflows/workflow-mutations';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import type { ApiError } from '@/services/api/api-error';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { ADMIN_ROUTES } from '@/constants/routes';
import { describeDraftError } from '../../utils/describe-draft-error';
import { hasOtherVersions, useRemoveVersionOnUnmount } from '../utils/draft-cache';

/** Replaces the draft; a document carrying a new `id` or `version` moves it, and the page follows. */
export function useSaveDraft(
  workflowId: string,
  version: number,
  onWritten?: () => void,
): UseMutationResult<WorkflowDraft, ApiError, WorkflowDocumentInput> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const removeOnUnmount = useRemoveVersionOnUnmount();

  return useMutation({
    ...workflowMutations.save(workflowId, version),
    onSuccess: (draft) => {
      showSuccessToast('Draft saved.');
      if (draft.workflowId === workflowId && draft.version === version) return;

      const oldFamilyRemains =
        draft.workflowId === workflowId || hasOtherVersions(queryClient, workflowId, version);
      // The old family's versions list, when a rename leaves it non-empty; the new location's comes from meta.
      if (oldFamilyRemains && draft.workflowId !== workflowId) {
        void queryClient.invalidateQueries({
          queryKey: workflowQueries.versions(workflowId).queryKey,
        });
      }
      onWritten?.();
      const movedTo = `${ADMIN_ROUTES.workflows.details(draft.workflowId)}?version=${draft.version}`;
      void navigate(movedTo, { replace: true });
      // Removed once the editor unmounts: while it is mounted, a render would refetch the removed version.
      removeOnUnmount(workflowId, version, oldFamilyRemains);
    },
    onError: (error) => showErrorToast('Unable to save the draft:', describeDraftError(error)),
  });
}
