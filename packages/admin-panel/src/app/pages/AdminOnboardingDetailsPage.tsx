import type { ReactElement } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import {
  ADMIN_ONBOARDINGS_PATH,
  OnboardingScoresCard,
  OnboardingStateGraph,
  OnboardingSummaryCard,
  useAdminOnboardingDetails,
  WorkflowGraph,
} from '@/features/onboarding';
import { Button } from '../../shared/components/Button/Button';

/** Composes the details section: the onboarding's record and the state graph built from its trail. */
export function AdminOnboardingDetailsPage(): ReactElement {
  const { onboardingId = '' } = useParams();
  // Query string the list handed over when the row was opened, so going back restores its filters.
  const { search } = useLocation();
  const { phase, summary, transitions, graph, scores, transitionsTruncated, error, refetch } =
    useAdminOnboardingDetails(onboardingId);

  let statusMessage: string;

  if (phase === 'loading') {
    statusMessage = 'Loading onboarding…';
  } else if (phase === 'error') {
    statusMessage = `Unable to load onboarding: ${error ?? 'Request failed.'}`;
  } else if (summary === null) {
    statusMessage = 'No onboarding matches this ID.';
  } else if (transitions.length === 0) {
    statusMessage = 'No state transitions have been recorded for this onboarding yet.';
  } else if (transitionsTruncated) {
    statusMessage = `Showing the ${transitions.length} most recently recorded transitions; earlier ones are not displayed.`;
  } else {
    statusMessage = `Showing ${transitions.length} recorded transitions.`;
  }

  return (
    <>
      <h2 className="detail-title">Onboarding details</h2>
      <div className="detail-header">
        <Link className="link" to={{ pathname: ADMIN_ONBOARDINGS_PATH, search }}>
          ← Back to onboardings
        </Link>
        <Button size="md" disabled={phase === 'loading'} onClick={refetch}>
          Reload
        </Button>
      </div>
      <p className="status-region" role="status" aria-live="polite">
        {statusMessage}
      </p>
      {summary !== null && (
        <div className="detail-layout">
          <div className="detail-layout__side">
            <OnboardingSummaryCard summary={summary} />
            <OnboardingScoresCard scores={scores} />
          </div>
          {graph !== null ? (
            <section className="detail-card detail-layout__main" aria-label="Workflow">
              <WorkflowGraph graph={graph} />
            </section>
          ) : (
            transitions.length > 0 && (
              <section className="detail-card" aria-label="State transitions">
                <h3 className="detail-card__title">State transitions</h3>
                <OnboardingStateGraph transitions={transitions} />
              </section>
            )
          )}
        </div>
      )}
    </>
  );
}
