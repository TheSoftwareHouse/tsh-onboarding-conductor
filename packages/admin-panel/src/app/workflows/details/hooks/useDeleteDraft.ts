import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { workflowMutations } from '@/api/workflows/workflow-mutations';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import type { ApiError } from '@/services/api/api-error';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { ADMIN_ROUTES } from '@/constants/routes';
import { describeDraftError } from '../../utils/describe-draft-error';
import { hasOtherVersions, useRemoveVersionOnUnmount } from '../utils/draft-cache';

/** Deletes the draft, then leaves for its family when other versions remain, else for the list. */
export function useDeleteDraft(
  workflowId: string,
  version: number,
  onWritten?: () => void,
): UseMutationResult<void, ApiError, void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const removeOnUnmount = useRemoveVersionOnUnmount();

  return useMutation({
    ...workflowMutations.delete(workflowId, version),
    onSuccess: () => {
      const familyRemains = hasOtherVersions(queryClient, workflowId, version);
      showSuccessToast('Draft deleted.');
      if (familyRemains) {
        void queryClient.invalidateQueries({
          queryKey: workflowQueries.versions(workflowId).queryKey,
        });
      }
      onWritten?.();
      void navigate(
        familyRemains ? ADMIN_ROUTES.workflows.details(workflowId) : ADMIN_ROUTES.workflows.root,
        { replace: true },
      );
      // Removed once the editor unmounts: while it is mounted, a render would refetch the removed version.
      removeOnUnmount(workflowId, version, familyRemains);
    },
    onError: (error) => showErrorToast('Unable to delete the draft:', describeDraftError(error)),
  });
}
