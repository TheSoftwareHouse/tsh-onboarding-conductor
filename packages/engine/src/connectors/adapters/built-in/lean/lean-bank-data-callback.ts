import {
  LEAN_BANK_CONNECT_OUTCOME_CONNECTED,
  LEAN_EVENT_ENTITY_CREATED,
  LEAN_EVENT_ENTITY_DATA_REFRESH_UPDATED,
  LEAN_EVENT_ENTITY_UPDATED,
  LEAN_INSIGHTS_LOOKBACK_MONTHS,
  LEAN_REFRESH_STATUS_FINISHED,
  LEAN_REFRESH_STATUS_PENDING,
  LEAN_USABLE_DATA_STATUSES,
  type LeanBankDataCallbackFields,
  type LeanEmployment,
  type LeanIncome,
  type LeanIncomeCategory,
} from './lean-contract';

/** What a callback's `data_status` says about each kind of data the refresh pulled. */
export type LeanDataStatus = Readonly<{
  accounts?: string;
  account_data?: ReadonlyArray<Readonly<{ transactions?: string }>>;
}>;

/**
 * A Lean webhook the adapter acts on. `entity.created` and `entity.updated` echo `app_user_id`;
 * `entity.data.refresh.updated` carries only `customer_id`, so the onboarding is read back from
 * Lean.
 */
export type LeanCallbackEvent =
  | Readonly<{ kind: 'entity'; customerId: string; appUserId: string }>
  | Readonly<{
      kind: 'refresh';
      customerId: string;
      entityId: string;
      finished: boolean;
      dataStatus: LeanDataStatus | undefined;
    }>;

const DATE_PART_LENGTH = 10;

const SIGNATURE_PREFIX_PATTERN = /^sha512=/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/** `lean-signature: sha512=<hex>`; the engine compares the hex digest, so the prefix goes. */
export const parseLeanSignatureHeader = (headerValue: string): readonly string[] => [
  headerValue.trim().replace(SIGNATURE_PREFIX_PATTERN, ''),
];

const parseDataStatus = (value: unknown): LeanDataStatus | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const accountData = Array.isArray(value.account_data)
    ? value.account_data.filter(isRecord).map((account) => ({
        transactions: readString(account, 'transactions'),
      }))
    : undefined;

  return { accounts: readString(value, 'accounts'), account_data: accountData };
};

/**
 * Reads the signed envelope `{type, payload}`. `undefined` is an event the adapter has no use for
 * (`bank.availability.updated`, a malformed or unrelated body): the caller acknowledges it.
 */
export const parseLeanCallback = (rawBody: Uint8Array): LeanCallbackEvent | undefined => {
  let envelope: unknown;

  try {
    envelope = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return undefined;
  }

  if (!isRecord(envelope) || !isRecord(envelope.payload)) {
    return undefined;
  }

  const { payload } = envelope;
  const customerId = readString(payload, 'customer_id');

  if (customerId === undefined) {
    return undefined;
  }

  if (envelope.type === LEAN_EVENT_ENTITY_CREATED || envelope.type === LEAN_EVENT_ENTITY_UPDATED) {
    const appUserId = readString(payload, 'app_user_id');

    return appUserId === undefined ? undefined : { kind: 'entity', customerId, appUserId };
  }

  if (envelope.type !== LEAN_EVENT_ENTITY_DATA_REFRESH_UPDATED) {
    return undefined;
  }

  const entityId = readString(payload, 'entity_id');
  const status = readString(payload, 'status');

  if (
    entityId === undefined ||
    (status !== LEAN_REFRESH_STATUS_FINISHED && status !== LEAN_REFRESH_STATUS_PENDING)
  ) {
    return undefined;
  }

  return {
    kind: 'refresh',
    customerId,
    entityId,
    finished: status === LEAN_REFRESH_STATUS_FINISHED,
    dataStatus: parseDataStatus(payload.data_status),
  };
};

const isUsable = (status: string | undefined): boolean =>
  status !== undefined && LEAN_USABLE_DATA_STATUSES.includes(status);

/**
 * Whether a finished refresh left data the insights can be computed from: the accounts were read
 * and every account's transactions came through (`PARTIAL` counts).
 */
export const isLeanDataUsable = (dataStatus: LeanDataStatus | undefined): boolean =>
  isUsable(dataStatus?.accounts) &&
  (dataStatus?.account_data ?? []).every((account) => isUsable(account.transactions));

/** `YYYY-MM-DD` in UTC, `LEAN_INSIGHTS_LOOKBACK_MONTHS` before `now`. */
export const buildLeanInsightsStartDate = (now: Date): string => {
  const start = new Date(now);

  start.setUTCMonth(start.getUTCMonth() - LEAN_INSIGHTS_LOOKBACK_MONTHS);

  return start.toISOString().slice(0, DATE_PART_LENGTH);
};

const averageOf = (category: LeanIncomeCategory | undefined): number =>
  category?.total.average_monthly_amount ?? 0;

/**
 * Income and employment insights as the callback fields the `bank_connect` step declares. Only
 * derived aggregates leave this function: no transaction, balance or account number.
 */
export const mapLeanInsights = (
  income: LeanIncome,
  employment: LeanEmployment,
  minMonthlySalary: number,
): LeanBankDataCallbackFields => {
  const { salary, non_salary: nonSalary } = income.insights;
  const employers = employment.insights.employment_details;
  const consistentEmployer = employers.find((employer) => employer.salary_consistent === true);
  const employer = consistentEmployer ?? employers[0];
  const employerName =
    employer?.matched_reference_employer?.name?.en ?? employer?.bank_employer_name ?? undefined;

  const salaryMonthlyAverage = averageOf(salary);

  return {
    bankConnectOutcome: LEAN_BANK_CONNECT_OUTCOME_CONNECTED,
    salaryMonthlyAverage,
    salaryMonthsDetected: (salary?.monthly_totals ?? []).filter((month) => month.count > 0).length,
    nonSalaryMonthlyAverage: averageOf(nonSalary),
    salaryConsistent: consistentEmployer !== undefined,
    salaryThresholdMet: salaryMonthlyAverage >= minMonthlySalary,
    ...(employerName === undefined ? {} : { employerName }),
  };
};
