const DAY_MS = 86_400_000;

export interface BankTransaction {
  dates?: Record<string, string>;
  [key: string]: unknown;
}

export interface BankAccount {
  balance?: number;
  balanceDate: string;
  currency?: string;
  owners?: Array<{ name?: string }>;
  bank?: { name?: string };
  iban?: string;
  type?: string;
  number?: string;
  transactions?: BankTransaction[];
  [key: string]: unknown;
}

export interface BankData {
  accounts: BankAccount[];
  [key: string]: unknown;
}

function shift(value: string, deltaMs: number): string {
  const time = Date.parse(value);

  return Number.isNaN(time) ? value : new Date(time + deltaMs).toISOString();
}

/**
 * Returns a copy of `bankData` with every `balanceDate` and every `transactions[].dates.*`
 * shifted by `today - max(balanceDate)`, `today` being 12:00 UTC. Algoan ignores transactions
 * older than 90 days before the balance date, so the personae's stored dates must move before
 * each push. Same rule as `scripts/rebase-bank-data-dates.cjs` (re-implemented, not imported):
 * whole days only, so the time of day in the source file is preserved.
 */
export function rebaseDates(bankData: BankData, today: Date = new Date()): BankData {
  const latest = Math.max(
    ...bankData.accounts
      .map((account) => Date.parse(account.balanceDate))
      .filter((t) => !Number.isNaN(t)),
  );

  if (!Number.isFinite(latest)) {
    throw new Error('No account carries a parsable balanceDate');
  }

  const todayNoon = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12);
  const deltaMs = Math.round((todayNoon - latest) / DAY_MS) * DAY_MS;

  return {
    ...bankData,
    accounts: bankData.accounts.map((account) => ({
      ...account,
      balanceDate: shift(account.balanceDate, deltaMs),
      transactions: (account.transactions ?? []).map((transaction) => ({
        ...transaction,
        dates: Object.fromEntries(
          Object.entries(transaction.dates ?? {}).map(([key, value]) => [
            key,
            shift(value, deltaMs),
          ]),
        ),
      })),
    })),
  };
}
