import { mutationOptions } from '@/services/query-client/mutation-options';
import {
  deleteWorkflowConnectorSelection,
  putWorkflowConnectorSelection,
  type ConnectorSelectionTarget,
} from './workflow-connector-selection';
import {
  compileWorkflowDocument,
  createWorkflowDraft,
  deleteWorkflowDraft,
  publishWorkflowDraft,
  updateWorkflowDraft,
  type WorkflowDocumentInput,
  type WorkflowDraft,
} from './workflow-drafts';
import { workflowQueries } from './workflow-queries';

function isInPlace(draft: WorkflowDraft, workflowId: string, version: number): boolean {
  return draft.workflowId === workflowId && draft.version === version;
}

/** Sibling module to `workflow-drafts.ts` and `workflow-connector-selection.ts` on purpose, so `vi.mock`-ing either still intercepts the `mutationFn` calls. */
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
  publish: (workflowId: string, version: number) =>
    mutationOptions({
      mutationFn: () => publishWorkflowDraft(workflowId, version),
      meta: {
        // Awaited so the page swaps the editor for the graph before the caller navigates.
        awaits: [workflowQueries.versions(workflowId).queryKey],
        // Never `detailsFor`: it would refetch the mounted editor's document.
        invalidates: [workflowQueries.lists(), workflowQueries.detail(workflowId).queryKey],
      },
    }),
  compile: () =>
    mutationOptions({
      mutationFn: (document: WorkflowDocumentInput) => compileWorkflowDocument(document),
    }),
  // A selection may change every version's read, so every read below the family is awaited:
  // the caller's toast fires once the inspector shows the new slot.
  selectConnector: (workflowId: string) =>
    mutationOptions({
      mutationFn: ({
        stepName,
        connectorId,
        target,
      }: {
        stepName: string;
        connectorId: string;
        target: ConnectorSelectionTarget;
      }) => putWorkflowConnectorSelection(workflowId, stepName, connectorId, target),
      meta: { awaits: [workflowQueries.detailsFor(workflowId)] },
    }),
  clearConnector: (workflowId: string) =>
    mutationOptions({
      mutationFn: ({ stepName, target }: { stepName: string; target: ConnectorSelectionTarget }) =>
        deleteWorkflowConnectorSelection(workflowId, stepName, target),
      meta: { awaits: [workflowQueries.detailsFor(workflowId)] },
    }),
};
