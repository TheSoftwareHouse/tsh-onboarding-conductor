import { useEffect, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ReactFlowProvider } from '@xyflow/react';
import { HttpStatusCode } from 'axios';
import { Link, useLocation, useParams } from 'react-router';
import { Button } from '@/components/ui/Button/Button';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState/ErrorState';
import { Loader } from '@/components/ui/Loader/Loader';
import { LoadFailure } from '@/components/ui/LoadFailure/LoadFailure';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import type { WorkflowDefinition } from '@/api/workflows/workflow-definitions';
import type { ApiError } from '@/services/api/api-error';
import {
  WORKFLOW_VERSION_STATUS,
  type WorkflowVersion,
  type WorkflowVersionStatus,
} from '@/api/workflows/workflow-versions';
import { ADMIN_ROUTES } from '@/constants/routes';
import { NewDraftDialog } from '../components/NewDraftDialog/NewDraftDialog';
import { DraftEditor, type DraftHeaderSlots } from './components/DraftEditor/DraftEditor';
import { VersionCanvas } from './components/VersionCanvas/VersionCanvas';
import { VersionDocument } from './components/VersionDocument/VersionDocument';
import { VersionGraph } from './components/VersionGraph';
import { VersionTabs } from './components/VersionTabs/VersionTabs';
import { WorkflowDetailsHeader } from './components/WorkflowDetailsHeader';
import { WorkflowStats } from './components/WorkflowStats';
import { useWorkflowDetailsSearchParams } from './hooks/useWorkflowDetailsSearchParams';
import { stripDetailsParams } from './utils/workflow-details-search-params';

interface MissingVersion {
  kind: 'notFound' | 'empty';
  title: string;
}

const MISSING_VERSION_BODY = 'Choose one from the version list.';
const NO_PUBLISHED_VERSION: MissingVersion = {
  kind: 'empty',
  title: 'This workflow has no published version',
};

const versionNotFound = (version: number): MissingVersion => ({
  kind: 'notFound',
  title: `Version ${version} does not exist`,
});

/** Why the versions list leaves nothing to show for this URL, or null when it holds a version to open. */
function findMissingVersion(
  versions: WorkflowVersion[],
  pinnedVersion: number | null,
): MissingVersion | null {
  if (pinnedVersion !== null) {
    return versions.some((entry) => entry.version === pinnedVersion)
      ? null
      : versionNotFound(pinnedVersion);
  }
  // Unpinned, the page opens the highest published version, or else the draft.
  const hasOpenable = versions.some(
    (entry) =>
      entry.status === WORKFLOW_VERSION_STATUS.published ||
      entry.status === WORKFLOW_VERSION_STATUS.draft,
  );
  return hasOpenable ? null : NO_PUBLISHED_VERSION;
}

function MissingVersionState({ kind, title }: MissingVersion): ReactElement {
  const props = {
    title,
    body: MISSING_VERSION_BODY,
  } as const;
  return kind === 'notFound' ? (
    <ErrorState kind="notFound" {...props} />
  ) : (
    <EmptyState {...props} />
  );
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
    return (
      <MissingVersionState
        {...(requestedVersion === null ? NO_PUBLISHED_VERSION : versionNotFound(requestedVersion))}
      />
    );
  }

  if (error !== null) {
    return <LoadFailure subject="this version" error={error} onRetry={onRetry} />;
  }

  if (details === null) {
    return <Loader label="Loading version…" />;
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
    isFetchedAfterMount: isVersionsFetchedAfterMount,
    error: versionsError,
    refetch: refetchVersions,
  } = useQuery(workflowQueries.versions(workflowId));
  // A cached list predates any version published elsewhere since, so it is re-read before a pinned version is called missing.
  const isVersionsStale =
    params.version !== null &&
    isVersionsSuccess &&
    !isVersionsFetchedAfterMount &&
    !versions.some((entry) => entry.version === params.version);

  useEffect(() => {
    if (isVersionsStale) {
      void refetchVersions({ cancelRefetch: false });
    }
  }, [isVersionsStale, refetchVersions]);
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
  const missingVersion =
    isVersionsSuccess && !isVersionsFetching && !isVersionsStale
      ? findMissingVersion(versions, params.version)
      : null;
  const {
    data: details = null,
    error: detailsError,
    refetch: refetchDetails,
  } = useQuery({
    ...workflowQueries.detail(workflowId, requestedVersion ?? undefined),
    enabled: !holdDetails && !isVersionsStale && missingVersion === null,
  });
  const version = requestedVersion ?? details?.workflowVersion ?? null;
  const versionStatus = versions.find((entry) => entry.version === version)?.status ?? null;
  const isDraft = requestedVersion !== null && requestedStatus === WORKFLOW_VERSION_STATUS.draft;
  const backSearch = stripDetailsParams(search);

  const isReadOnlyVersion =
    versionStatus === WORKFLOW_VERSION_STATUS.published ||
    versionStatus === WORKFLOW_VERSION_STATUS.retired;
  const newVersionAction =
    isReadOnlyVersion && version !== null ? (
      <NewDraftDialog initialFork={{ workflowId, version }} />
    ) : undefined;

  const renderHeader = (slots: DraftHeaderSlots = {}): ReactElement => (
    <WorkflowDetailsHeader
      workflowId={workflowId}
      name={slots.name ?? details?.name ?? null}
      versions={versions}
      version={version}
      backSearch={backSearch}
      onVersionChange={params.setVersion}
      actions={slots.actions ?? newVersionAction}
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
      {(isVersionsPending || isVersionsStale) && <Loader label="Loading workflow…" />}
      {isVersionsError && (
        <LoadFailure
          error={versionsError}
          subject="workflow"
          onRetry={() => void refetchVersions()}
          notFound={{
            title: 'Workflow not found',
            body: `No workflow has the ID ${workflowId}.`,
            actions: (
              <Button
                as={Link}
                to={{ pathname: ADMIN_ROUTES.workflows.root, search: backSearch }}
                variant="primary"
                size="lg"
              >
                Back to workflows
              </Button>
            ),
          }}
        />
      )}
      {isVersionsSuccess && missingVersion !== null && <MissingVersionState {...missingVersion} />}
      {isVersionsSuccess && !isVersionsStale && missingVersion === null && (
        <VersionTabs
          key={version}
          value={params.view ?? 'compiled'}
          onValueChange={params.setView}
          canvas={
            version === null ? (
              <Loader label="Loading version…" />
            ) : (
              <VersionCanvas workflowId={workflowId} version={version} />
            )
          }
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
