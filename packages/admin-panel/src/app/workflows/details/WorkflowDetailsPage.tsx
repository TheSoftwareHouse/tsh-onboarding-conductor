import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ReactFlowProvider } from '@xyflow/react';
import { HttpStatusCode } from 'axios';
import { Link, useLocation, useParams } from 'react-router';
import { Button } from '@/components/ui/Button/Button';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { Typography } from '@/components/ui/Typography/Typography';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import type { WorkflowDefinition } from '@/api/workflows/workflow-definitions';
import type { ApiError } from '@/services/api/api-error';
import {
  WORKFLOW_VERSION_STATUS,
  type WorkflowVersion,
  type WorkflowVersionStatus,
} from '@/api/workflows/workflow-versions';
import { ADMIN_ROUTES } from '@/constants/routes';
import { DraftEditor, type DraftHeaderSlots } from './components/DraftEditor/DraftEditor';
import { VersionDocument } from './components/VersionDocument/VersionDocument';
import { VersionGraph } from './components/VersionGraph';
import { VersionTabs } from './components/VersionTabs/VersionTabs';
import { WorkflowDetailsHeader } from './components/WorkflowDetailsHeader';
import { WorkflowStats } from './components/WorkflowStats';
import { useWorkflowDetailsSearchParams } from './hooks/useWorkflowDetailsSearchParams';
import { stripDetailsParams } from './utils/workflow-details-search-params';

interface FailureProps {
  message: string;
  onRetry: () => void;
}

function Failure({ message, onRetry }: FailureProps): ReactElement {
  return (
    <div className="flex flex-col items-start gap-4 p-8">
      <StatusRegion>{message}</StatusRegion>
      <Button variant="secondary" size="md" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

interface VersionsFailureProps {
  workflowId: string;
  error: ApiError;
  backSearch: string;
  onRetry: () => void;
}

/** The versions list could not be read: an unknown workflow, or any other failure with a Retry. */
function VersionsFailure({
  workflowId,
  error,
  backSearch,
  onRetry,
}: VersionsFailureProps): ReactElement {
  if (error.status !== HttpStatusCode.NotFound) {
    return <Failure message={`Unable to load workflow: ${error.message}`} onRetry={onRetry} />;
  }

  return (
    <div className="flex flex-col items-start gap-4 p-8">
      <StatusRegion>Workflow {workflowId} not found.</StatusRegion>
      <Typography
        as={Link}
        to={{ pathname: ADMIN_ROUTES.workflows.root, search: backSearch }}
        variant="body-sm"
        className="text-tsh-black"
      >
        ← Back to workflows
      </Typography>
    </div>
  );
}

/** Why the versions list leaves nothing to show for this URL, or null when it holds a version to open. */
function findMissingVersionMessage(
  versions: WorkflowVersion[],
  pinnedVersion: number | null,
): string | null {
  if (pinnedVersion !== null) {
    return versions.some((entry) => entry.version === pinnedVersion)
      ? null
      : `Version ${pinnedVersion} does not exist.`;
  }
  // Unpinned, the page opens the highest published version, or else the draft.
  const hasOpenable = versions.some(
    (entry) =>
      entry.status === WORKFLOW_VERSION_STATUS.published ||
      entry.status === WORKFLOW_VERSION_STATUS.draft,
  );
  return hasOpenable ? null : 'This workflow has no published version.';
}

interface VersionContentProps {
  workflowId: string;
  details: WorkflowDefinition | null;
  error: ApiError | null;
  /** The `?version=` asked for, or null when the read was unpinned. */
  requestedVersion: number | null;
  requestedStep: string | null;
  versionStatus: WorkflowVersionStatus | null;
  onSelectStep: (step: string) => void;
  onRetry: () => void;
}

/** The shown version's graph and inspector, or why there is none to show yet. */
function VersionContent({
  workflowId,
  details,
  error,
  requestedVersion,
  requestedStep,
  versionStatus,
  onSelectStep,
  onRetry,
}: VersionContentProps): ReactElement {
  if (error?.status === HttpStatusCode.NotFound) {
    const missing =
      requestedVersion === null
        ? 'This workflow has no published version.'
        : `Version ${requestedVersion} does not exist.`;

    return (
      <StatusRegion className="px-8 py-6">{missing} Choose one from the version list.</StatusRegion>
    );
  }

  if (error !== null) {
    return <Failure message={`Unable to load this version: ${error.message}`} onRetry={onRetry} />;
  }

  if (details === null) {
    return <StatusRegion className="px-8 py-6">Loading version…</StatusRegion>;
  }

  return (
    <VersionGraph
      workflowId={workflowId}
      definition={details}
      requestedStep={requestedStep}
      versionStatus={versionStatus}
      onSelectStep={onSelectStep}
    />
  );
}

/** `/workflows/:workflowId`: one stored version of a workflow — its read-only graph and a step inspector whose connector can be switched. */
export function WorkflowDetailsPage(): ReactElement {
  const { workflowId = '' } = useParams();
  const { search } = useLocation();
  const params = useWorkflowDetailsSearchParams();
  const {
    data: versions = [],
    isPending: isVersionsPending,
    isError: isVersionsError,
    isSuccess: isVersionsSuccess,
    isFetching: isVersionsFetching,
    error: versionsError,
    refetch: refetchVersions,
  } = useQuery(workflowQueries.versions(workflowId));
  // The unpinned read serves only published versions, so a family without one opens its draft.
  const fallbackDraft =
    params.version === null &&
    !versions.some((entry) => entry.status === WORKFLOW_VERSION_STATUS.published)
      ? versions.find((entry) => entry.status === WORKFLOW_VERSION_STATUS.draft)
      : undefined;
  const requestedVersion = params.version ?? fallbackDraft?.version ?? null;
  const requestedStatus = versions.find((entry) => entry.version === requestedVersion)?.status;
  // A draft is never compiled for this page, and a pinned version's status is unknown while the list loads.
  const holdDetails =
    requestedVersion !== null &&
    (requestedStatus === WORKFLOW_VERSION_STATUS.draft ||
      (requestedStatus === undefined && isVersionsFetching));
  // Judged on a settled list only, so a refetch after a write never flashes it.
  const missingVersionMessage =
    isVersionsSuccess && !isVersionsFetching
      ? findMissingVersionMessage(versions, params.version)
      : null;
  const {
    data: details = null,
    error: detailsError,
    refetch: refetchDetails,
  } = useQuery({
    ...workflowQueries.detail(workflowId, requestedVersion ?? undefined),
    enabled: !holdDetails && missingVersionMessage === null,
  });
  const version = requestedVersion ?? details?.workflowVersion ?? null;
  const versionStatus = versions.find((entry) => entry.version === version)?.status ?? null;
  const isDraft = requestedVersion !== null && requestedStatus === WORKFLOW_VERSION_STATUS.draft;
  const backSearch = stripDetailsParams(search);

  const renderHeader = (slots: DraftHeaderSlots = {}): ReactElement => (
    <WorkflowDetailsHeader
      workflowId={workflowId}
      name={slots.name ?? details?.name ?? null}
      versions={versions}
      version={version}
      backSearch={backSearch}
      onVersionChange={params.setVersion}
      actions={slots.actions}
      note={slots.note}
    />
  );

  if (isDraft && requestedVersion !== null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <DraftEditor
          key={`${workflowId}/${requestedVersion}`}
          workflowId={workflowId}
          version={requestedVersion}
          renderHeader={renderHeader}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {renderHeader()}
      {isVersionsPending && <StatusRegion className="px-8 py-6">Loading workflow…</StatusRegion>}
      {isVersionsError && (
        <VersionsFailure
          workflowId={workflowId}
          error={versionsError}
          backSearch={backSearch}
          onRetry={() => void refetchVersions()}
        />
      )}
      {isVersionsSuccess && missingVersionMessage !== null && (
        <StatusRegion className="px-8 py-6">
          {missingVersionMessage} Choose one from the version list.
        </StatusRegion>
      )}
      {isVersionsSuccess && missingVersionMessage === null && (
        <VersionTabs
          key={version}
          value={params.view ?? 'graph'}
          onValueChange={params.setView}
          graph={
            <ReactFlowProvider>
              <WorkflowStats definition={details} />
              <VersionContent
                workflowId={workflowId}
                details={details}
                error={detailsError}
                requestedVersion={requestedVersion}
                requestedStep={params.step}
                versionStatus={versionStatus}
                onSelectStep={params.setStep}
                onRetry={() => void refetchDetails()}
              />
            </ReactFlowProvider>
          }
          json={
            version === null ? (
              <VersionContent
                workflowId={workflowId}
                details={null}
                error={detailsError}
                requestedVersion={requestedVersion}
                requestedStep={null}
                versionStatus={null}
                onSelectStep={params.setStep}
                onRetry={() => void refetchDetails()}
              />
            ) : (
              <VersionDocument workflowId={workflowId} version={version} />
            )
          }
        />
      )}
    </div>
  );
}
