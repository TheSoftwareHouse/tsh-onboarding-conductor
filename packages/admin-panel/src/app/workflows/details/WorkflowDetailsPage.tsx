import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ReactFlowProvider } from '@xyflow/react';
import { HttpStatusCode } from 'axios';
import { Link, useLocation, useParams } from 'react-router';
import { Button } from '@/components/ui/Button/Button';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { Typography } from '@/components/ui/Typography/Typography';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import type {
  WorkflowDefinition,
  WorkflowDefinitionFetchError,
} from '@/api/workflows/workflow-definitions';
import type {
  WorkflowVersionStatus,
  WorkflowVersionsFetchError,
} from '@/api/workflows/workflow-versions';
import { ADMIN_ROUTES } from '@/constants/routes';
import { WorkflowGraph } from './components/WorkflowGraph/WorkflowGraph';
import { StepInspector } from './components/StepInspector/StepInspector';
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
  error: WorkflowVersionsFetchError;
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

interface VersionContentProps {
  workflowId: string;
  details: WorkflowDefinition | null;
  error: WorkflowDefinitionFetchError | null;
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

  const selectedStep =
    details?.steps.find((step) => step.name === requestedStep) ??
    details?.steps.find((step) => step.name === details.initialStep);

  if (details === null || selectedStep === undefined) {
    return <StatusRegion className="px-8 py-6">Loading version…</StatusRegion>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden">
      <div className="flex min-h-110 min-w-0 shrink-0 border-b border-border-rule bg-bg-subtle xl:min-h-0 xl:shrink xl:grow xl:basis-160 xl:border-r xl:border-b-0 [&_.react-flow]:bg-transparent">
        <WorkflowGraph
          definition={details}
          selectedStep={selectedStep.name}
          onSelectStep={onSelectStep}
        />
      </div>
      <StepInspector workflowId={workflowId} step={selectedStep} versionStatus={versionStatus} />
    </div>
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
    error: versionsError,
    refetch: refetchVersions,
  } = useQuery(workflowQueries.versions(workflowId));
  const {
    data: details = null,
    error: detailsError,
    refetch: refetchDetails,
  } = useQuery(workflowQueries.detail(workflowId, params.version ?? undefined));
  const version = params.version ?? details?.workflowVersion ?? null;
  const versionStatus = versions.find((entry) => entry.version === version)?.status ?? null;
  const backSearch = stripDetailsParams(search);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkflowDetailsHeader
        workflowId={workflowId}
        name={details?.name ?? null}
        versions={versions}
        version={version}
        backSearch={backSearch}
        onVersionChange={params.setVersion}
      />
      {isVersionsPending && <StatusRegion className="px-8 py-6">Loading workflow…</StatusRegion>}
      {isVersionsError && (
        <VersionsFailure
          workflowId={workflowId}
          error={versionsError}
          backSearch={backSearch}
          onRetry={() => void refetchVersions()}
        />
      )}
      {isVersionsSuccess && (
        <ReactFlowProvider>
          <WorkflowStats definition={details} />
          <VersionContent
            workflowId={workflowId}
            details={details}
            error={detailsError}
            requestedVersion={params.version}
            requestedStep={params.step}
            versionStatus={versionStatus}
            onSelectStep={params.setStep}
            onRetry={() => void refetchDetails()}
          />
        </ReactFlowProvider>
      )}
    </div>
  );
}
