import type { QueryClient } from '@tanstack/react-query';
import { workflowQueries } from '@/api/workflows/workflow-queries';

/** Whether the cached versions list holds a version besides `leaving`; the engine deletes a family left empty. */
export function hasOtherVersions(
  queryClient: QueryClient,
  workflowId: string,
  leaving: number,
): boolean {
  const versions = queryClient.getQueryData(workflowQueries.versions(workflowId).queryKey) ?? [];
  return versions.some((entry) => entry.version !== leaving);
}

/** Drops what a write left behind: the family when it was emptied, else only the one version. */
export function removeVersion(
  queryClient: QueryClient,
  workflowId: string,
  version: number,
  familyRemains: boolean,
): void {
  queryClient.removeQueries({
    queryKey: familyRemains
      ? workflowQueries.detail(workflowId, version).queryKey
      : workflowQueries.detailsFor(workflowId),
  });
}
