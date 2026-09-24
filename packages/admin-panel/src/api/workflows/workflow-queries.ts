import { queryOptions } from '@tanstack/react-query';
import {
  fetchWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowDefinitionFetchError,
} from './workflow-definitions';

/** Sibling module to `workflow-definitions.ts` on purpose, so `vi.mock('@/api/workflows/workflow-definitions')` still intercepts `detail`'s cross-module `queryFn` call. */
export const workflowQueries = {
  all: () => ['workflows'] as const,
  details: () => [...workflowQueries.all(), 'details'] as const,
  detail: (workflowId: string, version: number) =>
    queryOptions<WorkflowDefinition, WorkflowDefinitionFetchError>({
      queryKey: [...workflowQueries.details(), workflowId, version],
      queryFn: () => fetchWorkflowDefinition(workflowId, version),
    }),
};
