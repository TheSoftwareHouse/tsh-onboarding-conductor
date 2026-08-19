import type { ReactElement } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import {
  ADMIN_ONBOARDINGS_PATH,
  OnboardingStateGraph,
  OnboardingSummaryCard,
  useAdminOnboardingDetails,
  WorkflowGraph,
} from '@/features/onboarding';

/** Composes the details section: the onboarding's record and the state graph built from its trail. */
export function AdminOnboardingDetailsPage(): ReactElement {
  const { onboardingId = '' } = useParams();
  // Query string the list handed over when the row was opened, so going back restores its filters.
  const { search } = useLocation();
  const { phase, summary, transitions, graph, transitionsTruncated, error, refetch } =
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
        <button type="button" disabled={phase === 'loading'} onClick={refetch}>
          Reload
        </button>
      </div>
      <p className="status-region" role="status" aria-live="polite">
        {statusMessage}
      </p>
      {summary !== null && (
        <div className="detail-layout">
          <OnboardingSummaryCard summary={summary} />
          {graph !== null ? (
            <section className="detail-card" aria-label="Workflow">
              <div className="detail-card__scroller">
                <WorkflowGraph graph={graph} />
              </div>
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
