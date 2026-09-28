import type { ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useQueryStates } from 'nuqs';
import { useLocation, useParams } from 'react-router';
import { auditQueries } from '@/api/audit/audit-queries';
import type { AdminOnboardingSummary } from '@/api/onboardings/admin-onboardings';
import { FilterTab, FilterTabs } from '@/components/ui/FilterTabs/FilterTabs';
import { OnboardingActivityLog } from './components/OnboardingActivityLog/OnboardingActivityLog';
import { OnboardingDetailsHeader } from './components/OnboardingDetailsHeader/OnboardingDetailsHeader';
import { OnboardingPathStrip } from './components/OnboardingPathStrip/OnboardingPathStrip';
import { OnboardingRunMeta } from './components/OnboardingRunMeta/OnboardingRunMeta';
import { OnboardingScoresPanel } from './components/OnboardingScoresPanel/OnboardingScoresPanel';
import {
  useAdminOnboardingDetails,
  type UseAdminOnboardingDetailsResult,
} from './hooks/useAdminOnboardingDetails';
import { useOnboardingReview } from './hooks/useOnboardingReview';
import { detailsSearchParams, serializeDetailsTab } from './utils/details-search-params';

/** The list's own search string, with this page's `tab` param stripped, for the back link. */
function stripTabParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('tab');
  const remaining = params.toString();
  return remaining === '' ? '' : `?${remaining}`;
}

/** The page's live status line: what is happening to it or what could not be read; null otherwise. */
function describeDetailsStatus(details: UseAdminOnboardingDetailsResult): string | null {
  if (details.phase === 'loading') {
    return 'Loading onboarding…';
  }

  if (details.phase === 'error') {
    return `Unable to load onboarding: ${details.error ?? 'Request failed.'}`;
  }

  if (details.summary === null) {
    return 'No onboarding matches this ID.';
  }

  return null;
}

/** Composes the details page: its own header band, the run-meta strip, and the History/Scores tabs. */
export function OnboardingDetailsPage(): ReactElement {
  const { onboardingId = '' } = useParams();
  const { search } = useLocation();
  const queryClient = useQueryClient();
  const details = useAdminOnboardingDetails(onboardingId);
  const {
    phase,
    summary,
    transitions,
    lastTransitionOccurredAt,
    definition,
    scores,
    transitionsTruncated,
    refetch,
  } = details;
  const [{ tab }] = useQueryStates(detailsSearchParams, { shallow: false });
  // A workflow that declares no scores has no Scores tab, so `?tab=scores` falls back to History.
  const hasScores = scores.length > 0;
  const openTab = hasScores ? tab : 'history';
  const { pendingAction, submit } = useOnboardingReview(onboardingId);

  /** The Reload control's own refresh: the page's own reads, plus the audit trail the activity log reads. */
  function handleReload(): void {
    refetch();
    void queryClient.invalidateQueries({ queryKey: auditQueries.all() });
  }

  /** The open tab's content; exhaustive, so a new tab does not compile until it renders something. */
  function renderTab(openSummary: AdminOnboardingSummary): ReactElement {
    switch (openTab) {
      case 'history':
        return (
          <>
            <OnboardingPathStrip transitions={transitions} truncated={transitionsTruncated} />
            <OnboardingActivityLog onboardingId={onboardingId} />
          </>
        );
      case 'scores':
        return (
          <OnboardingScoresPanel
            scores={scores}
            workflowId={openSummary.workflowId}
            workflowVersion={openSummary.workflowVersion}
          />
        );
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <OnboardingDetailsHeader
        onboardingId={onboardingId}
        summary={summary}
        definition={definition}
        backSearch={stripTabParam(search)}
        onRefresh={handleReload}
        isRefreshing={phase === 'loading'}
        pendingAction={pendingAction}
        onReviewSubmit={submit}
        statusMessage={describeDetailsStatus(details)}
      />
      {summary !== null && (
        <>
          <OnboardingRunMeta
            summary={summary}
            lastTransitionOccurredAt={lastTransitionOccurredAt}
          />
          <FilterTabs label="Onboarding sections">
            <FilterTab to={serializeDetailsTab('history', search)} active={openTab === 'history'}>
              History
            </FilterTab>
            {hasScores && (
              <FilterTab
                to={serializeDetailsTab('scores', search)}
                active={openTab === 'scores'}
                count={scores.length}
              >
                Scores
              </FilterTab>
            )}
          </FilterTabs>
          <div className="min-h-0 flex-1 overflow-y-auto">{renderTab(summary)}</div>
        </>
      )}
    </div>
  );
}
