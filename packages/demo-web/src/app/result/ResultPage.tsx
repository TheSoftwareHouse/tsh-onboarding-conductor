import { Link } from 'react-router';

import { Button } from '@/components/ui/button';

import { DecisionBanner } from './DecisionBanner';
import { ResultTabs } from './ResultTabs';
import { SessionGate, useSessionView } from '../session/useSessionView';

export function ResultPage() {
  const state = useSessionView('result');

  if (state.status !== 'ready') {
    return <SessionGate state={state} />;
  }

  const { view } = state;
  const { creditScore, creditScoreBand } = view.data;

  return (
    <div className="flex flex-col gap-8">
      <DecisionBanner
        decision={view.decision ?? 'review'}
        score={typeof creditScore === 'number' ? creditScore : undefined}
        band={typeof creditScoreBand === 'string' ? creditScoreBand : undefined}
      />
      <ResultTabs view={view} />
      <div>
        <Button variant="outline" asChild>
          <Link to="/">Run another scenario</Link>
        </Button>
      </div>
    </div>
  );
}
