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
  detail: (workflowId: string, version: number) =>
    queryOptions<WorkflowDefinition, WorkflowDefinitionFetchError>({
      queryKey: [...workflowQueries.details(), workflowId, version],
      queryFn: () => fetchWorkflowDefinition(workflowId, version),
    }),
};
