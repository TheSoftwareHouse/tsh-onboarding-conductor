import { Link } from 'react-router';

import { KSA_JOURNEY } from '@/api/bnpl/bnpl.client';
import { Button } from '@/components/ui/button';

import { DecisionBanner } from './DecisionBanner';
import { LeanIncomePanel } from './LeanIncomePanel';
import { MoneyProvider } from './money';
import { ResultTabs } from './ResultTabs';
import { StartOverButton } from '../session/StartOver';
import { SessionGate, useSessionView } from '../session/useSessionView';

export function ResultPage() {
  const state = useSessionView('result');

  if (state.status !== 'ready') {
    return <SessionGate state={state} />;
  }

  const { token, view } = state;
  const { creditScore, creditScoreBand } = view.data;

  return (
    <div className="flex flex-col gap-8">
      <DecisionBanner
        decision={view.decision ?? 'review'}
        score={typeof creditScore === 'number' ? creditScore : undefined}
        band={typeof creditScoreBand === 'string' ? creditScoreBand : undefined}
      />
      {view.journey === KSA_JOURNEY ? <LeanIncomePanel data={view.data} /> : null}
      <MoneyProvider journey={view.journey}>
        <ResultTabs view={view} />
      </MoneyProvider>
      <div className="flex gap-2">
        <StartOverButton token={token} variant="default" size="default" />
        <Button variant="outline" asChild>
          <Link to="/">Home</Link>
        </Button>
      </div>
    </div>
  );
}
