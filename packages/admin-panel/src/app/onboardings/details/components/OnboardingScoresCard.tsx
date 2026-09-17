import { Fragment, type ReactElement } from 'react';
import type { OnboardingScoreView } from '../hooks/useAdminOnboardingDetails';

export interface OnboardingScoresCardProps {
  scores: OnboardingScoreView[];
}

/** A score's current value over its declared maximum, or the value alone when none is declared. */
function formatScore({ value, bounds }: OnboardingScoreView): string {
  return bounds === null ? String(value) : `${value}/${bounds.max}`;
}

/**
 * The onboarding's current scores, as the same key/value pairs the record card uses. Renders
 * nothing when the onboarding carries no scores, so a workflow that declares no scoring does not
 * leave an empty card on the page.
 */
export function OnboardingScoresCard({ scores }: OnboardingScoresCardProps): ReactElement | null {
  if (scores.length === 0) {
    return null;
  }

  return (
    <section className="detail-card" aria-label="Onboarding scores">
      <h3 className="detail-card__title">Onboarding scores</h3>
      <dl className="metadata-list">
        {scores.map((score) => (
          <Fragment key={score.name}>
            <dt>{score.name}</dt>
            <dd>{formatScore(score)}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}
