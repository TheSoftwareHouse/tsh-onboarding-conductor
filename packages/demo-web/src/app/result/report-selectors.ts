import type { JsonValue, SessionAccount, SessionView } from '@/api/bnpl/bnpl.client';

/**
 * Selectors over the engine's `/state.data` and the credit report inside it. The report is the
 * provider's analysis (the Algoan sandbox shape or the mock provider's smaller one); every
 * selector tolerates missing sections and returns `null` or an empty list for them.
 */

export type Band = 'approve' | 'review' | 'decline';
export type Json = Record<string, JsonValue>;

export const SCORE_MAX = 1000;
export const APPROVE_FROM = 700;
export const REVIEW_FROM = 400;
export const INDICATOR_LIMIT = 5;
export const PAYMENT_SCORE_MAX = 10;
const DAYS_PER_MONTH = 30;

export function asRecord(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function asArray(value: unknown): JsonValue[] {
  return Array.isArray(value) ? (value as JsonValue[]) : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function path(root: unknown, ...keys: string[]): unknown {
  let current: unknown = root;
  for (const key of keys) {
    const record = asRecord(current);
    if (!record) {
      return undefined;
    }
    current = record[key];
  }
  return current;
}

export function selectReport(data: Json | undefined): Json | null {
  return asRecord(data?.creditReport);
}

export function bandForScore(score: number): Band {
  if (score >= APPROVE_FROM) {
    return 'approve';
  }
  return score >= REVIEW_FROM ? 'review' : 'decline';
}

export function parseBand(value: unknown): Band | null {
  return value === 'approve' || value === 'review' || value === 'decline' ? value : null;
}

export interface ScoreSelection {
  value: number;
  band: Band;
  version: string | null;
}

/** The 0-1000 credit score; `creditScoreBand` wins over the default thresholds when present. */
export function selectCreditScore(data: Json | undefined): ScoreSelection | null {
  const report = selectReport(data);
  const value =
    asNumber(data?.creditScore) ?? asNumber(path(report, 'scores', 'creditScore', 'value'));
  if (value === null) {
    return null;
  }
  return {
    value,
    band: parseBand(data?.creditScoreBand) ?? bandForScore(value),
    version: asText(path(report, 'scores', 'creditScore', 'version')),
  };
}

export interface Indicator {
  key: 'livingStandard' | 'budgetManagement' | 'financialEvolution';
  label: string;
  value: number | null;
}

const INDICATOR_LABELS: Array<[Indicator['key'], string]> = [
  ['livingStandard', 'Living standard'],
  ['budgetManagement', 'Budget management'],
  ['financialEvolution', 'Financial evolution'],
];

/** Always the three indicators, in display order; `value` is `null` when not computed. */
export function selectIndicators(data: Json | undefined): Indicator[] {
  const source =
    asRecord(data?.creditIndicators) ??
    asRecord(path(selectReport(data), 'scores', 'creditScore', 'indicators'));
  return INDICATOR_LABELS.map(([key, label]) => ({ key, label, value: asNumber(source?.[key]) }));
}

export interface PaymentScore {
  value: number;
  scale: number;
  version: string | null;
}

export function selectPaymentScore(data: Json | undefined): PaymentScore | null {
  const secondary = asRecord(path(data?.creditSecondaryScores, 'paymentScore'));
  const fromReport = asRecord(path(selectReport(data), 'scores', 'paymentScore'));
  const value = asNumber(secondary?.value) ?? asNumber(fromReport?.value);
  if (value === null) {
    return null;
  }
  return {
    value,
    scale: asNumber(secondary?.scale) ?? PAYMENT_SCORE_MAX,
    version: asText(secondary?.version) ?? asText(fromReport?.version),
  };
}

function monthsInWindow(report: Json | null): number | null {
  const days = asNumber(path(report, 'metadata', 'numberOfDaysInWindow'));
  return days && days > 0 ? days / DAYS_PER_MONTH : null;
}

function monthlyOf(section: unknown, months: number | null): number | null {
  const monthly = asNumber(path(section, 'monthlyAmount'));
  if (monthly !== null) {
    return monthly;
  }
  const total = asNumber(path(section, 'totalAmount'));
  return total !== null && months ? total / months : null;
}

export interface InsightTiles {
  incomes: number | null;
  expenses: number | null;
  repayments: number | null;
  discretionary: number | null;
}

export function selectInsightTiles(data: Json | undefined): InsightTiles {
  const report = selectReport(data);
  const months = monthsInWindow(report);
  const insights = path(report, 'creditInsights');
  const essentials = path(report, 'essentials');
  const incomes =
    asNumber(path(essentials, 'monthlyRegularIncome')) ??
    monthlyOf(path(insights, 'incomes'), months);
  const expenses =
    asNumber(path(essentials, 'monthlyEssentialExpenses')) ??
    monthlyOf(path(insights, 'expenses'), months);
  const repayments =
    asNumber(path(essentials, 'monthlyLoanRepayments')) ??
    monthlyOf(path(insights, 'loans', 'repayments'), months);
  const discretionary =
    incomes !== null && expenses !== null ? incomes - expenses - (repayments ?? 0) : null;
  return { incomes, expenses, repayments, discretionary };
}

export interface CalendarEntry {
  month: string;
  amount: number;
}

export interface CategoryRow {
  kind: 'income' | 'expense';
  name: string;
  totalAmount: number | null;
  monthlyAmount: number | null;
  calendar: CalendarEntry[];
}

function calendarOf(value: unknown): CalendarEntry[] {
  return asArray(value).flatMap((entry) => {
    const record = asRecord(entry);
    const month = asText(record?.month);
    const amount = asNumber(record?.amount);
    return month !== null && amount !== null ? [{ month, amount }] : [];
  });
}

export function selectCategories(data: Json | undefined): CategoryRow[] {
  const report = selectReport(data);
  const months = monthsInWindow(report);
  const sections: Array<[CategoryRow['kind'], string]> = [
    ['income', 'incomes'],
    ['expense', 'expenses'],
  ];
  return sections.flatMap(([kind, key]) =>
    asArray(path(report, 'creditInsights', key, 'categories')).flatMap((entry) => {
      const record = asRecord(entry);
      const name = asText(record?.name);
      if (!record || name === null) {
        return [];
      }
      return [
        {
          kind,
          name,
          totalAmount: asNumber(record.totalAmount),
          monthlyAmount: monthlyOf(record, months),
          calendar: calendarOf(record.calendar),
        },
      ];
    }),
  );
}

export interface RiskRow {
  key: string;
  label: string;
  value: number | null;
  unit: 'money' | 'count' | 'days' | 'flag';
}

/** `null` marks "not computed" for the whole section; a row's `value` null is per-row. */
export function selectRisks(data: Json | undefined): RiskRow[] | null {
  const risks = asRecord(path(selectReport(data), 'creditInsights', 'risks'));
  if (!risks) {
    return null;
  }
  const flag = asRecord(path(risks, 'overdraft'))?.minimumBalanceReached;
  const rows: RiskRow[] = [
    {
      key: 'gambling',
      label: 'Gambling',
      value: asNumber(path(risks, 'gambling', 'totalAmount')),
      unit: 'money',
    },
    {
      key: 'paymentRejections',
      label: 'Payment rejections',
      value: asNumber(path(risks, 'incidents', 'paymentRejections', 'totalAmount')),
      unit: 'money',
    },
    {
      key: 'overdraftMinimumBalance',
      label: 'Overdraft minimum balance reached',
      value: typeof flag === 'boolean' ? Number(flag) : asNumber(flag),
      unit: 'flag',
    },
    {
      key: 'overdraftDuration',
      label: 'Overdraft duration',
      value: asNumber(path(risks, 'overdraft', 'duration')),
      unit: 'days',
    },
    {
      key: 'overdraftFees',
      label: 'Overdraft fees',
      value: asNumber(path(risks, 'overdraft', 'fees', 'totalAmount')),
      unit: 'money',
    },
    {
      key: 'wageAdvance',
      label: 'Wage advance',
      value: amountOrCount(risks.wageAdvance),
      unit: 'money',
    },
    {
      key: 'debtCollection',
      label: 'Debt collection',
      value: amountOrCount(risks.debtCollection),
      unit: 'money',
    },
    { key: 'bailiff', label: 'Bailiff', value: amountOrCount(risks.bailiff), unit: 'money' },
  ];
  return rows;
}

function amountOrCount(section: unknown): number | null {
  return asNumber(section) ?? asNumber(path(section, 'totalAmount'));
}

export interface LoanSummary {
  kind: 'repayments' | 'drawdowns';
  count: number | null;
  totalAmount: number | null;
  monthlyAmount: number | null;
}

export function selectLoans(data: Json | undefined): LoanSummary[] | null {
  const loans = asRecord(path(selectReport(data), 'creditInsights', 'loans'));
  if (!loans) {
    return null;
  }
  const kinds: Array<LoanSummary['kind']> = ['repayments', 'drawdowns'];
  return kinds.map((kind) => ({
    kind,
    count: asNumber(path(loans, kind, 'count')),
    totalAmount: asNumber(path(loans, kind, 'totalAmount')),
    monthlyAmount: asNumber(path(loans, kind, 'monthlyAmount')),
  }));
}

export interface TransactionRow {
  id: string;
  date: string | null;
  description: string;
  category: string | null;
  amount: number;
  currency: string | null;
}

function transactionDate(record: Json): string | null {
  const dates = asRecord(record.dates);
  return asText(dates?.debitedAt) ?? asText(dates?.bookedAt) ?? asText(record.date);
}

/** A collection stored as a plain array (Algoan) or as `{ resources: [...] }` (the mock). */
function collectionOf(value: unknown): JsonValue[] {
  return Array.isArray(value) ? asArray(value) : asArray(asRecord(value)?.resources);
}

export function selectTransactions(data: Json | undefined): TransactionRow[] {
  const resources = collectionOf(path(selectReport(data), 'transactions'));
  return resources.flatMap((entry, index) => {
    const record = asRecord(entry);
    const amount = asNumber(record?.amount);
    if (!record || amount === null) {
      return [];
    }
    return [
      {
        id: asText(record.id) ?? `row-${index}`,
        date: transactionDate(record),
        description: asText(record.description) ?? '',
        category: asText(path(record, 'enrichments', 'category')),
        amount,
        currency: asText(record.currency),
      },
    ];
  });
}

/** Sorts by date, undated rows last; a stable copy, the input is untouched. */
export function sortTransactionsByDate(
  rows: readonly TransactionRow[],
  direction: 'asc' | 'desc',
): TransactionRow[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    if (left.date === right.date) {
      return 0;
    }
    if (left.date === null) {
      return 1;
    }
    if (right.date === null) {
      return -1;
    }
    return left.date < right.date ? -sign : sign;
  });
}

export function selectAccounts(view: Pick<SessionView, 'accounts'>): SessionAccount[] {
  return view.accounts ?? [];
}

const MASK_VISIBLE = 4;

/** Keeps the last four characters, e.g. `**** 4321`. */
export function maskIdentifier(value: string | null): string | null {
  const compact = value?.replace(/\s+/g, '') ?? '';
  if (compact === '') {
    return null;
  }
  return compact.length <= MASK_VISIBLE ? compact : `**** ${compact.slice(-MASK_VISIBLE)}`;
}

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

export function formatGbp(value: number): string {
  return GBP.format(value);
}
