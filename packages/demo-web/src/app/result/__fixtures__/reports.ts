import type { Json } from '../report-selectors';

/** Small reports shaped like the Algoan sandbox output; amounts and labels are authored. */

interface PersonaSpec {
  score: number;
  band: 'approve' | 'review' | 'decline';
  indicators: [number, number, number];
  payment: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  repayments: number;
  gambling: number;
}

function build(spec: PersonaSpec): Json {
  const [livingStandard, budgetManagement, financialEvolution] = spec.indicators;
  const report = {
    scores: {
      creditScore: {
        value: spec.score,
        version: '1.0.0',
        indicators: { livingStandard, budgetManagement, financialEvolution },
      },
      paymentScore: { value: spec.payment, version: '1.1.0' },
    },
    metadata: { numberOfDaysInWindow: 90 },
    creditInsights: {
      incomes: {
        totalAmount: spec.monthlyIncome * 3,
        monthlyAmount: spec.monthlyIncome,
        categories: [
          {
            name: 'salary',
            totalAmount: spec.monthlyIncome * 3,
            monthlyAmount: spec.monthlyIncome,
            calendar: [
              { month: '2026-07', amount: spec.monthlyIncome },
              { month: '2026-08', amount: spec.monthlyIncome },
              { month: '2026-09', amount: spec.monthlyIncome },
            ],
          },
        ],
      },
      expenses: {
        totalAmount: spec.monthlyExpenses * 3,
        monthlyAmount: spec.monthlyExpenses,
        categories: [
          {
            name: 'groceries',
            totalAmount: spec.monthlyExpenses * 1.2,
            monthlyAmount: spec.monthlyExpenses * 0.4,
            calendar: [
              { month: '2026-07', amount: spec.monthlyExpenses * 0.35 },
              { month: '2026-08', amount: spec.monthlyExpenses * 0.45 },
              { month: '2026-09', amount: spec.monthlyExpenses * 0.4 },
            ],
          },
          {
            name: 'rent',
            totalAmount: spec.monthlyExpenses * 1.8,
            monthlyAmount: spec.monthlyExpenses * 0.6,
            calendar: [],
          },
        ],
      },
      loans: {
        repayments: {
          count: spec.repayments > 0 ? 3 : 0,
          totalAmount: spec.repayments * 3,
          monthlyAmount: spec.repayments,
        },
        drawdowns: { count: 0, totalAmount: 0, monthlyAmount: 0 },
      },
      risks: {
        gambling: { totalAmount: spec.gambling },
        incidents: { paymentRejections: { totalAmount: spec.gambling / 2 } },
        overdraft: {
          minimumBalanceReached: spec.band === 'decline',
          duration: spec.band === 'decline' ? 21 : 0,
          fees: { totalAmount: spec.band === 'decline' ? 48 : 0 },
        },
        wageAdvance: { totalAmount: 0 },
        debtCollection: { totalAmount: 0 },
        bailiff: { totalAmount: 0 },
      },
      cashFlows: [],
    },
    accounts: [{ id: 'acc-1', bankName: 'Fixture Bank', balance: 1250.5, currency: 'GBP' }],
    essentials: {
      monthlyRegularIncome: spec.monthlyIncome,
      monthlyEssentialExpenses: spec.monthlyExpenses,
      monthlyLoanRepayments: spec.repayments,
    },
    transactions: {
      resources: [
        {
          id: 't1',
          dates: { debitedAt: '2026-09-25' },
          description: 'ACME LTD SALARY',
          amount: spec.monthlyIncome,
          currency: 'GBP',
          enrichments: { category: 'salary', type: 'income' },
        },
        {
          id: 't2',
          dates: { debitedAt: '2026-09-27' },
          description: 'TESCO STORES',
          amount: -62.4,
          currency: 'GBP',
          enrichments: { category: 'groceries', type: 'expense' },
        },
        {
          id: 't3',
          dates: { debitedAt: '2026-09-02' },
          description: 'LANDLORD RENT',
          amount: -spec.monthlyExpenses * 0.6,
          currency: 'GBP',
          enrichments: { category: 'rent', type: 'expense' },
        },
      ],
    },
  };
  return {
    creditOutcome:
      spec.band === 'approve' ? 'approved' : spec.band === 'review' ? 'review' : 'declined',
    creditScore: spec.score,
    creditScoreBand: spec.band,
    creditIndicators: { livingStandard, budgetManagement, financialEvolution },
    creditSecondaryScores: {
      paymentScore: { value: spec.payment, scale: '1-10', version: '1.1.0' },
    },
    creditReport: report,
  };
}

export const sherlockData = build({
  score: 965,
  band: 'approve',
  indicators: [3, 4, 1],
  payment: 10,
  monthlyIncome: 4200,
  monthlyExpenses: 1900,
  repayments: 0,
  gambling: 0,
});
export const watsonData = build({
  score: 598,
  band: 'review',
  indicators: [-3, 5, 2],
  payment: 3,
  monthlyIncome: 2600,
  monthlyExpenses: 2100,
  repayments: 250,
  gambling: 40,
});
export const moriartyData = build({
  score: 362,
  band: 'decline',
  indicators: [-5, 0, 4],
  payment: 2,
  monthlyIncome: 1800,
  monthlyExpenses: 2200,
  repayments: 420,
  gambling: 380,
});
export const emptyData: Json = { creditReport: {} };
