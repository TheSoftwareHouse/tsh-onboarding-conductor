import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { WorkflowPublication } from '@/api/workflows/workflow-drafts';
import { workflowMutations } from '@/api/workflows/workflow-mutations';
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

  return useMutation({
    ...workflowMutations.publish(workflowId, version),
    onSuccess: () => {
      showSuccessToast(`Version ${version} published.`);
      void navigate(`${ADMIN_ROUTES.workflows.details(workflowId)}?version=${version}`, {
        replace: true,
      });
    },
    onError: (error) => showErrorToast('Unable to publish the draft:', describeDraftError(error)),
  });
}
