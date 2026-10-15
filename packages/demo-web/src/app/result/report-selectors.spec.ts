import { describe, expect, it } from 'vitest';

import { emptyData, moriartyData, sherlockData, watsonData } from './__fixtures__/reports';
import {
  bandForScore,
  maskIdentifier,
  selectAccounts,
  selectCategories,
  selectCreditScore,
  selectIndicators,
  selectInsightTiles,
  selectLoans,
  selectPaymentScore,
  selectRisks,
  selectTransactions,
  sortTransactionsByDate,
} from './report-selectors';
import type { Json } from './report-selectors';

const personae = [
  { name: 'Sherlock', data: sherlockData, score: 965, band: 'approve', payment: 10, gap: 2300 },
  { name: 'Watson', data: watsonData, score: 598, band: 'review', payment: 3, gap: 250 },
  { name: 'Moriarty', data: moriartyData, score: 362, band: 'decline', payment: 2, gap: -820 },
] as const;

describe('report selectors on a persona report', () => {
  it.each(personae)('reads the score, band and payment score for $name', (persona) => {
    expect(selectCreditScore(persona.data)).toMatchObject({
      value: persona.score,
      band: persona.band,
      version: '1.0.0',
    });
    expect(selectPaymentScore(persona.data)).toEqual({
      value: persona.payment,
      scale: 10,
      version: '1.1.0',
    });
  });

  it.each(personae)('derives discretionary income for $name', (persona) => {
    const tiles = selectInsightTiles(persona.data);
    expect(tiles.discretionary).toBe(persona.gap);
    expect(tiles.incomes).not.toBeNull();
  });

  it('returns the three indicators in display order', () => {
    expect(selectIndicators(sherlockData).map((entry) => [entry.label, entry.value])).toEqual([
      ['Living standard', 3],
      ['Budget management', 4],
      ['Financial evolution', 1],
    ]);
  });

  it('lists categories, risks, loans and sorted transactions', () => {
    const categories = selectCategories(watsonData);
    expect(categories.map((row) => `${row.kind}:${row.name}`)).toEqual([
      'income:salary',
      'expense:groceries',
      'expense:rent',
    ]);
    expect(categories[0].calendar).toHaveLength(3);
    expect(selectRisks(moriartyData)?.find((row) => row.key === 'gambling')?.value).toBe(380);
    expect(selectLoans(watsonData)?.[0]).toMatchObject({ count: 3, monthlyAmount: 250 });

    const rows = selectTransactions(watsonData);
    expect(rows).toHaveLength(3);
    expect(sortTransactionsByDate(rows, 'asc')[0].description).toBe('LANDLORD RENT');
    expect(sortTransactionsByDate(rows, 'desc')[0].description).toBe('TESCO STORES');
  });

  it('prefers creditScoreBand over the default thresholds', () => {
    expect(selectCreditScore({ creditScore: 900, creditScoreBand: 'review' })?.band).toBe('review');
  });
});

describe('report selectors on the mock provider report', () => {
  const mock = {
    creditScore: 600,
    creditReport: {
      metadata: { numberOfDaysInWindow: 90 },
      creditInsights: {
        incomes: { totalAmount: 3000, categories: [{ name: 'salary', totalAmount: 3000 }] },
        expenses: { totalAmount: 900, categories: [{ name: 'living', totalAmount: 900 }] },
      },
      transactions: {
        resources: [{ amount: 3000, description: 'pay', enrichments: { category: 'salary' } }],
      },
    },
  };

  it('derives monthly amounts from the window', () => {
    expect(selectInsightTiles(mock)).toEqual({
      incomes: 1000,
      expenses: 300,
      repayments: null,
      discretionary: 700,
    });
    expect(selectCategories(mock)[0].monthlyAmount).toBe(1000);
    expect(selectTransactions(mock)[0]).toMatchObject({ date: null, category: 'salary' });
    expect(selectRisks(mock)).toBeNull();
  });
});

describe('report selectors on a stored Algoan report', () => {
  const algoan: Json = {
    creditReport: {
      transactions: [
        {
          id: 't1',
          dates: { debitedAt: '2026-09-02T00:00:00.000Z' },
          description: 'TESCO STORES',
          amount: -42.5,
          currency: 'GBP',
          enrichments: { category: 'groceries' },
        },
        { id: 't2', description: 'no amount' },
      ],
    },
  };

  it('reads transactions stored as a plain array', () => {
    expect(selectTransactions(algoan)).toEqual([
      {
        id: 't1',
        date: '2026-09-02T00:00:00.000Z',
        description: 'TESCO STORES',
        category: 'groceries',
        amount: -42.5,
        currency: 'GBP',
      },
    ]);
  });
});

describe('report selectors on an empty report', () => {
  it('returns not-computed values and never throws', () => {
    expect(selectCreditScore(emptyData)).toBeNull();
    expect(selectCreditScore(undefined)).toBeNull();
    expect(selectPaymentScore(emptyData)).toBeNull();
    expect(selectIndicators(emptyData).every((entry) => entry.value === null)).toBe(true);
    expect(selectInsightTiles(emptyData)).toEqual({
      incomes: null,
      expenses: null,
      repayments: null,
      discretionary: null,
    });
    expect(selectCategories(emptyData)).toEqual([]);
    expect(selectRisks(emptyData)).toBeNull();
    expect(selectLoans(emptyData)).toBeNull();
    expect(selectTransactions(emptyData)).toEqual([]);
    expect(selectAccounts({})).toEqual([]);
  });
});

describe('helpers', () => {
  it('maps scores to bands at the thresholds', () => {
    expect([399, 400, 699, 700].map(bandForScore)).toEqual([
      'decline',
      'review',
      'review',
      'approve',
    ]);
  });

  it('masks identifiers', () => {
    expect(maskIdentifier('GB82 WEST 1234 5698 7654 32')).toBe('**** 5432');
    expect(maskIdentifier(null)).toBeNull();
  });
});
