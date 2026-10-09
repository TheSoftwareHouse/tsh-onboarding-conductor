import { mutationOptions } from '@/services/query-client/mutation-options';
import {
  compileWorkflowDocument,
  createWorkflowDraft,
  deleteWorkflowDraft,
  updateWorkflowDraft,
  type WorkflowDocumentInput,
  type WorkflowDraft,
} from './workflow-drafts';
import { workflowQueries } from './workflow-queries';

function isInPlace(draft: WorkflowDraft, workflowId: string, version: number): boolean {
  return draft.workflowId === workflowId && draft.version === version;
}

/** Sibling module to `workflow-drafts.ts` on purpose, so `vi.mock`-ing it still intercepts the `mutationFn` calls. */
export const workflowMutations = {
  create: () =>
    mutationOptions({
      mutationFn: (document: WorkflowDocumentInput) => createWorkflowDraft(document),
      meta: {
        invalidates: (draft) => [
          workflowQueries.lists(),
          workflowQueries.versions(draft.workflowId).queryKey,
          // A visit before the draft existed may have cached a 404 for it.
          workflowQueries.detail(draft.workflowId, draft.version).queryKey,
        ],
      },
    }),
  save: (workflowId: string, version: number) =>
    mutationOptions({
      mutationFn: (document: WorkflowDocumentInput) =>
        updateWorkflowDraft(workflowId, version, document),
      meta: {
        // Awaited so the caller settles its text against the refetched document.
        awaits: (draft) =>
          isInPlace(draft, workflowId, version)
            ? [
                workflowQueries.detail(workflowId, version).queryKey,
                workflowQueries.versions(workflowId).queryKey,
              ]
            : [],
        invalidates: (draft) =>
          isInPlace(draft, workflowId, version)
            ? [workflowQueries.lists()]
            : [
                workflowQueries.lists(),
                workflowQueries.versions(draft.workflowId).queryKey,
                workflowQueries.detail(draft.workflowId, draft.version).queryKey,
              ],
      },
    }),
  delete: (workflowId: string, version: number) =>
    mutationOptions({
      mutationFn: () => deleteWorkflowDraft(workflowId, version),
      meta: { invalidates: [workflowQueries.lists()] },
    }),
  compile: () =>
    mutationOptions({
      mutationFn: (document: WorkflowDocumentInput) => compileWorkflowDocument(document),
    }),
};
