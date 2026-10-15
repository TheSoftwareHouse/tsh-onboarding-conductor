import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { InsightsCategories } from './InsightsCategories';
import { InsightsIndicators } from './InsightsIndicators';
import { NotComputed } from './NotComputed';
import { TransactionsTable } from './TransactionsTable';
import {
  type Json,
  selectCategories,
  selectInsightTiles,
  selectLoans,
  selectReport,
  selectRisks,
  selectTransactions,
} from './report-selectors';

export function InsightsTab({ data }: { data: Json }) {
  if (!selectReport(data)) {
    return <NotComputed what="credit insights" />;
  }
  return (
    <Tabs defaultValue="categories">
      <TabsList>
        <TabsTrigger value="categories">Categories</TabsTrigger>
        <TabsTrigger value="indicators">Indicators</TabsTrigger>
        <TabsTrigger value="transactions">Transactions</TabsTrigger>
      </TabsList>
      <TabsContent value="categories">
        <InsightsCategories tiles={selectInsightTiles(data)} categories={selectCategories(data)} />
      </TabsContent>
      <TabsContent value="indicators">
        <InsightsIndicators risks={selectRisks(data)} loans={selectLoans(data)} />
      </TabsContent>
      <TabsContent value="transactions">
        <TransactionsTable rows={selectTransactions(data)} />
      </TabsContent>
    </Tabs>
  );
}
