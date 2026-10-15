import { WORKFLOW_VERSION_STATUS, type WorkflowVersion } from '@/api/workflows/workflow-versions';

/** The number a new version takes: one past the highest listed, whatever its status. */
export function nextWorkflowVersion(versions: WorkflowVersion[]): number {
  return versions.reduce((highest, { version }) => Math.max(highest, version), 0) + 1;
}

function latestWithStatus(versions: WorkflowVersion[], status: string): number | null {
  const numbers = versions.filter((entry) => entry.status === status).map(({ version }) => version);
  return numbers.length === 0 ? null : Math.max(...numbers);
}

/** The version a fork starts from: the latest published, else the latest retired, else none. */
export function defaultForkVersion(versions: WorkflowVersion[]): number | null {
  return (
    latestWithStatus(versions, WORKFLOW_VERSION_STATUS.published) ??
    latestWithStatus(versions, WORKFLOW_VERSION_STATUS.retired)
  );
}
