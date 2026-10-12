import type { ReactElement } from 'react';
import { Link } from 'react-router';
import type { AdminOnboardingSummary } from '@/api/onboardings/admin-onboardings';
import type { ManualReviewAction } from '@/api/onboardings/onboarding-review';
import type { WorkflowDefinition } from '@/api/workflows/workflow-definitions';
import { Button } from '@/components/ui/Button/Button';
import { Refresh } from '@/components/ui/icons';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { TextLink } from '@/components/ui/TextLink/TextLink';
import { Typography } from '@/components/ui/Typography/Typography';
import { ADMIN_ROUTES } from '@/constants/routes';
import { serializeWorkflowVersionSearch } from '@/lib/workflow-search-params';
import { OnboardingStatusChip } from '../../../components/OnboardingStatusChip/OnboardingStatusChip';
import { OnboardingReconcileAction } from './OnboardingReconcileAction/OnboardingReconcileAction';
import { OnboardingReviewActions } from './OnboardingReviewActions/OnboardingReviewActions';

export interface OnboardingDetailsHeaderProps {
  onboardingId: string;
  /** Null while loading, or when no onboarding matches this id. */
  summary: AdminOnboardingSummary | null;
  definition: WorkflowDefinition | null;
  /** Query string the list handed over, carried by the breadcrumb's back link. */
  backSearch: string;
  onRefresh: () => void;
  isRefreshing: boolean;
  /** The review action currently in flight, or null when none is. */
  pendingAction: ManualReviewAction | null;
  onReviewSubmit: (action: ManualReviewAction) => void;
  /** True while the parked connector's provider is being asked for its verdict. */
  isReconciling: boolean;
  onReconcile: () => void;
  /** The page's live status line; null when there is nothing to report. */
  statusMessage: string | null;
}

/** The details header band; summary-dependent parts render only once the summary has loaded. */
export function OnboardingDetailsHeader({
  onboardingId,
  summary,
  definition,
  backSearch,
  onRefresh,
  isRefreshing,
  pendingAction,
  onReviewSubmit,
  isReconciling,
  onReconcile,
  statusMessage,
}: OnboardingDetailsHeaderProps): ReactElement {
  // One write at a time: a review decision and a provider check both move the same onboarding.
  const actionPending = pendingAction !== null || isReconciling;

  return (
    <header className="flex flex-col gap-2 border-b border-border-rule px-8 py-5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Typography
              as={Link}
              to={{ pathname: ADMIN_ROUTES.onboardings.root, search: backSearch }}
              variant="caps-tiny"
              className="text-fg-4 no-underline hover:underline"
            >
              Onboardings
            </Typography>
            <Typography variant="caps-tiny" as="span" className="text-fg-4">
              /
            </Typography>
            <Typography variant="caps-tiny" as="span" className="text-fg-1">
              Detail
            </Typography>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Typography
              variant="h6"
              as="h1"
              className="max-w-full min-w-0 truncate font-mono font-normal"
            >
              {onboardingId}
            </Typography>
            {summary !== null && <OnboardingStatusChip status={summary.status} size="status" />}
          </div>
          {summary !== null && (
            <TextLink
              to={`${ADMIN_ROUTES.workflows.details(summary.workflowId)}${serializeWorkflowVersionSearch({ version: summary.workflowVersion })}`}
              className="self-start"
            >
              Workflow {summary.workflowId}{' '}
              <Typography as="span" variant="mono">
                v{summary.workflowVersion}
              </Typography>
            </TextLink>
          )}
        </div>
        <div className="flex flex-none items-center gap-2">
          {summary !== null && (
            <>
              <OnboardingReconcileAction
                pendingConnector={summary.pendingConnector}
                disabled={actionPending}
                onReconcile={onReconcile}
              />
              <OnboardingReviewActions
                definition={definition}
                currentStep={summary.currentStep}
                disabled={actionPending}
                onSubmit={onReviewSubmit}
              />
            </>
          )}
          <Button
            variant="secondary"
            size="icon"
            aria-label="Reload"
            // Reload resets the mutations, which would orphan a write still in flight.
            disabled={isRefreshing || actionPending}
            onClick={onRefresh}
          >
            <Refresh aria-hidden="true" className="size-4.5" />
          </Button>
        </div>
      </div>
      {statusMessage !== null && <StatusRegion>{statusMessage}</StatusRegion>}
    </header>
  );
}
