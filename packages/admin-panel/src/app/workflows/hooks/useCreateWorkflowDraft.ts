import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { type WorkflowDocumentInput, type WorkflowDraft } from '@/api/workflows/workflow-drafts';
import { workflowMutations } from '@/api/workflows/workflow-mutations';
import type { ApiError } from '@/services/api/api-error';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { ADMIN_ROUTES } from '@/constants/routes';
import { describeDraftError } from '../utils/describe-draft-error';

/** Creates a draft, then opens it in the editor. */
export function useCreateWorkflowDraft(): UseMutationResult<
  WorkflowDraft,
  ApiError,
  WorkflowDocumentInput
> {
  const navigate = useNavigate();

  return useMutation({
    ...workflowMutations.create(),
    onSuccess: ({ workflowId, version }) => {
      showSuccessToast('Draft created');
      void navigate(`${ADMIN_ROUTES.workflows.details(workflowId)}?version=${version}`);
    },
    onError: (error) => {
      showErrorToast('Could not create the draft', describeDraftError(error));
    },
  });
}
