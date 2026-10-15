import type { SessionView } from '@/api/bnpl/bnpl.client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { AccountsTab } from './AccountsTab';
import { IndicatorBars } from './IndicatorBars';
import { InsightsTab } from './InsightsTab';
import { NotComputed } from './NotComputed';
import { PaymentScoreTab } from './PaymentScoreTab';
import { RawJsonTab } from './RawJsonTab';
import { ScoreGauge } from './ScoreGauge';
import {
  selectAccounts,
  selectCreditScore,
  selectIndicators,
  selectPaymentScore,
} from './report-selectors';

export function ResultTabs({ view }: { view: SessionView }) {
  const data = view.data ?? {};
  const score = selectCreditScore(data);

  return (
    <Tabs defaultValue="score" data-testid="result-tabs">
      <TabsList className="max-w-full overflow-x-auto">
        <TabsTrigger value="score">Credit Score</TabsTrigger>
        <TabsTrigger value="payment">Payment Score</TabsTrigger>
        <TabsTrigger value="insights">Credit Insights</TabsTrigger>
        <TabsTrigger value="accounts">Accounts</TabsTrigger>
        <TabsTrigger value="raw">Raw JSON</TabsTrigger>
      </TabsList>
      <TabsContent value="score" className="grid gap-8 md:grid-cols-2">
        {score ? (
          <ScoreGauge score={score.value} band={score.band} />
        ) : (
          <NotComputed what="credit score" />
        )}
        <IndicatorBars indicators={selectIndicators(data)} />
      </TabsContent>
      <TabsContent value="payment">
        <PaymentScoreTab score={selectPaymentScore(data)} />
      </TabsContent>
      <TabsContent value="insights">
        <InsightsTab data={data} />
      </TabsContent>
      <TabsContent value="accounts">
        <AccountsTab accounts={selectAccounts(view)} />
      </TabsContent>
      <TabsContent value="raw">
        <RawJsonTab data={data} />
      </TabsContent>
    </Tabs>
  );
}
