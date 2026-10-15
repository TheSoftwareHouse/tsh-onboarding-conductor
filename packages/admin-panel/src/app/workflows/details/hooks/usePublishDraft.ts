import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { WorkflowPublication } from '@/api/workflows/workflow-drafts';
import { workflowMutations } from '@/api/workflows/workflow-mutations';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import type { ApiError } from '@/services/api/api-error';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { ADMIN_ROUTES } from '@/constants/routes';
import { describeDraftError } from '../../utils/describe-draft-error';

/** Publishes the saved draft, then opens that version's read-only view. */
export function usePublishDraft(
  workflowId: string,
  version: number,
): UseMutationResult<WorkflowPublication, ApiError, void> {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isPublished = useRef(false);

  // Removed on unmount, exact: while mounted the dialog's read would rebuild it, and `document` stays.
  useEffect(
    () => () => {
      if (isPublished.current) {
        queryClient.removeQueries({
          queryKey: workflowQueries.detail(workflowId, version).queryKey,
          exact: true,
        });
      }
    },
    [queryClient, workflowId, version],
  );

  return useMutation({
    ...workflowMutations.publish(workflowId, version),
    onSuccess: () => {
      isPublished.current = true;
      showSuccessToast(`Version ${version} published.`);
      void navigate(`${ADMIN_ROUTES.workflows.details(workflowId)}?version=${version}`, {
        replace: true,
      });
    },
    onError: (error) => showErrorToast('Unable to publish the draft:', describeDraftError(error)),
  });
}
