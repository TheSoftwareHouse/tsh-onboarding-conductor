import type { ReactElement } from 'react';
import {
  DefinitionList,
  type DefinitionListEntry,
} from '@/components/ui/DefinitionList/DefinitionList';
import { SectionHeader } from '@/components/ui/SectionHeader/SectionHeader';
import { Typography } from '@/components/ui/Typography/Typography';
import type { OnboardingScoreView } from '../../hooks/useAdminOnboardingDetails';

export interface OnboardingScoresPanelProps {
  scores: OnboardingScoreView[];
  workflowId: string;
  workflowVersion: number;
}

/** A score's current value over its declared maximum, or the value alone when none is declared. */
function formatScore({ value, bounds }: OnboardingScoreView): string {
  return bounds === null ? String(value) : `${value}/${bounds.max}`;
}

/** The Scores tab: each of the onboarding's scores against its declared bounds. */
export function OnboardingScoresPanel({
  scores,
  workflowId,
  workflowVersion,
}: OnboardingScoresPanelProps): ReactElement {
  const trailing = (
    <Typography variant="body-sm">
      Declared by{' '}
      <Typography as="span" variant="mono" className="text-fg-1">
        {workflowId} v{workflowVersion}
      </Typography>
    </Typography>
  );

  return (
    <section>
      <SectionHeader title="Scores" trailing={trailing} />
      <div className="px-8 pb-8">
        <DefinitionList
          termVariant="mono"
          entries={scores.map((score): DefinitionListEntry => ({
            key: score.name,
            term: score.name,
            description: formatScore(score),
          }))}
        />
        <Typography variant="body-sm" className="mt-4 text-fg-4">
          Raw workflow values. Scores without declared bounds show the bare number.
        </Typography>
      </div>
    </section>
  );
}
