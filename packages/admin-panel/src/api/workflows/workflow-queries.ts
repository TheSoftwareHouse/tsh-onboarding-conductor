import { queryOptions } from '@tanstack/react-query';
import {
  fetchAdminWorkflows,
  type AdminWorkflowQueryFilters,
  type AdminWorkflowsFetchError,
  type AdminWorkflowsPage,
} from './admin-workflows';
import {
  fetchWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowDefinitionFetchError,
} from './workflow-definitions';
import {
  fetchWorkflowVersions,
  type WorkflowVersion,
  type WorkflowVersionsFetchError,
} from './workflow-versions';

/** Sibling module to `admin-workflows.ts` and `workflow-definitions.ts` on purpose, so `vi.mock`-ing either still intercepts `list`'s and `detail`'s cross-module `queryFn` calls. */
export const workflowQueries = {
  all: () => ['workflows'] as const,
  lists: () => [...workflowQueries.all(), 'list'] as const,
  list: (filters: AdminWorkflowQueryFilters) =>
    queryOptions<AdminWorkflowsPage, AdminWorkflowsFetchError>({
      queryKey: [...workflowQueries.lists(), filters],
      queryFn: () => fetchAdminWorkflows(filters),
    }),
  details: () => [...workflowQueries.all(), 'details'] as const,
  /** One workflow's reads — every version's definition and the versions list — so one invalidation covers them all. */
  detailsFor: (workflowId: string) => [...workflowQueries.details(), workflowId] as const,
  /** Unpinned when `version` is omitted: the engine picks the version to serve. */
  detail: (workflowId: string, version?: number) =>
    queryOptions<WorkflowDefinition, WorkflowDefinitionFetchError>({
      queryKey: [...workflowQueries.detailsFor(workflowId), version],
      queryFn: () => fetchWorkflowDefinition(workflowId, version),
    }),
  versions: (workflowId: string) =>
    queryOptions<WorkflowVersion[], WorkflowVersionsFetchError>({
      queryKey: [...workflowQueries.detailsFor(workflowId), 'versions'],
      queryFn: () => fetchWorkflowVersions(workflowId),
    }),
};
