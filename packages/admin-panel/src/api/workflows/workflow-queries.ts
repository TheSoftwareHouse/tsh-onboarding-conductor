import { queryOptions } from '@tanstack/react-query';
import { fetchAdminWorkflows, type AdminWorkflowQueryFilters } from './admin-workflows';
import { fetchWorkflowDefinition } from './workflow-definitions';
import { fetchWorkflowDocument } from './workflow-drafts';
import { fetchWorkflowVersions } from './workflow-versions';

/** Sibling module to `admin-workflows.ts` and `workflow-definitions.ts` on purpose, so `vi.mock`-ing either still intercepts `list`'s and `detail`'s cross-module `queryFn` calls. */
export const workflowQueries = {
  all: () => ['workflows'] as const,
  lists: () => [...workflowQueries.all(), 'list'] as const,
  list: (filters: AdminWorkflowQueryFilters) =>
    queryOptions({
      queryKey: [...workflowQueries.lists(), filters],
      queryFn: () => fetchAdminWorkflows(filters),
    }),
  details: () => [...workflowQueries.all(), 'details'] as const,
  /** One workflow's reads — every version's definition and document and the versions list — so one invalidation covers them all. */
  detailsFor: (workflowId: string) => [...workflowQueries.details(), workflowId] as const,
  /** Unpinned when `version` is omitted: the engine picks the version to serve. A pinned key also covers that version's document. */
  detail: (workflowId: string, version?: number) =>
    queryOptions({
      queryKey: [...workflowQueries.detailsFor(workflowId), version],
      queryFn: () => fetchWorkflowDefinition(workflowId, version),
    }),
  document: (workflowId: string, version: number) =>
    queryOptions({
      queryKey: [...workflowQueries.detail(workflowId, version).queryKey, 'document'],
      queryFn: () => fetchWorkflowDocument(workflowId, version),
    }),
  versions: (workflowId: string) =>
    queryOptions({
      queryKey: [...workflowQueries.detailsFor(workflowId), 'versions'],
      queryFn: () => fetchWorkflowVersions(workflowId),
    }),
};
