import { createContext, useContext, type ReactNode } from 'react';

import { KSA_JOURNEY, type Journey } from '@/api/bnpl/bnpl.client';

/** The SAR to GBP rate the engine converts the exported document at (ADR 0050). */
export const SAR_TO_GBP_RATE = 0.197;

/**
 * How money is shown for a journey. Algoan's report and the account summary carry the document's
 * currency, GBP; on the KSA journey every figure is shown back in SAR at the same fixed rate the
 * engine converted it with, so the applicant reads riyals throughout.
 */
export interface Money {
  currency: 'GBP' | 'SAR';
  format(value: number): string;
}

const formatter = (currency: Money['currency']) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency });

const GBP_MONEY: Money = { currency: 'GBP', format: (value) => formatter('GBP').format(value) };
const SAR_MONEY: Money = {
  currency: 'SAR',
  format: (value) => formatter('SAR').format(value / SAR_TO_GBP_RATE),
};

export function moneyFor(journey: Journey | undefined): Money {
  return journey === KSA_JOURNEY ? SAR_MONEY : GBP_MONEY;
}

const MoneyContext = createContext<Money>(GBP_MONEY);

export function MoneyProvider({ journey, children }: { journey?: Journey; children: ReactNode }) {
  return <MoneyContext.Provider value={moneyFor(journey)}>{children}</MoneyContext.Provider>;
}

export function useMoney(): Money {
  return useContext(MoneyContext);
}
