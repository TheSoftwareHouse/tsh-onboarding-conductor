/**
 * Domain contract for the Lean Technologies (KSA) connector adapters' wire layer. Every value that
 * crosses a boundary — Lean's paths, webhook vocabulary, data statuses, the rejection reasons and
 * callback fields the workflow binds — is declared exactly once here, per
 * `.claude/rules/constants.md`. Response shapes were checked against the Lean KSA sandbox; fields
 * the adapters do not read are left out.
 */

export const LEAN_IBAN_VERIFICATION_CONNECTOR_ID = 'lean_iban_verification';
export const LEAN_BANK_DATA_CONNECTOR_ID = 'lean_bank_data';

export const LEAN_PATH_TOKEN = '/oauth2/token';
export const LEAN_PATH_VERIFY_ACCOUNT = '/verifications/v1/accounts';
export const LEAN_PATH_CUSTOMERS = '/customers/v1';
export const LEAN_PATH_CUSTOMER_BY_APP_USER_ID = '/customers/v1/app-user-id';
export const LEAN_PATH_CUSTOMER_ENTITIES_SUFFIX = 'entities';
export const LEAN_PATH_INCOME = '/insights/v2/income';
export const LEAN_PATH_EMPLOYMENT = '/insights/v2/income/employment';
export const LEAN_PATH_ACCOUNTS = '/data/v2/accounts';
/** `/data/v2/accounts/{account_id}/balances` and `/transactions`. */
export const LEAN_PATH_ACCOUNT_BALANCES_SUFFIX = 'balances';
export const LEAN_PATH_ACCOUNT_TRANSACTIONS_SUFFIX = 'transactions';

export const LEAN_GRANT_TYPE_CLIENT_CREDENTIALS = 'client_credentials';
export const LEAN_SCOPE_API = 'api';

export const LEAN_COUNTRY_CODE_SAUDI_ARABIA = 'SA';
export const LEAN_ACCOUNT_HOLDER_TYPE_PERSONAL = 'PERSONAL';
export const LEAN_ACCOUNT_DETAILS_TYPE_IBAN = 'IBAN';
export const LEAN_IDENTIFICATION_TYPE_NATIONAL_ID = 'NATIONAL_ID';

/** Which HTTP statuses the client reads as something other than a plain success or error. */
export const LEAN_HTTP_STATUS_UNAUTHORIZED = 401;
export const LEAN_HTTP_STATUS_NOT_FOUND = 404;
export const LEAN_HTTP_STATUS_ACCEPTED = 202;
export const LEAN_HTTP_STATUS_NOT_IMPLEMENTED = 501;
export const LEAN_HTTP_STATUS_SERVER_ERROR_FROM = 500;

/** Top-level `status` of a Lean response body. Error bodies carry the failure's own code instead. */
export const LEAN_RESULT_STATUS_OK = 'OK';
export const LEAN_RESULT_STATUS_PENDING = 'PENDING';
export const LEAN_ERROR_STATUS_INVALID_PARAMETERS = 'INVALID_PARAMETERS';
/** Stands in for the `status` of a 4xx answer that carried no readable Lean error body. */
export const LEAN_ERROR_STATUS_UNRECOGNIZED = 'UNRECOGNIZED_ERROR';
export const LEAN_ERROR_STATUS_UNKNOWN_CUSTOMER = 'UNKNOWN_CUSTOMER';

export const LEAN_ACCOUNT_STATUS_ACTIVE = 'ACTIVE';

/** Account vocabulary of the data API, as the KSA sandbox answers it. */
export const LEAN_ACCOUNT_SUB_TYPE_CURRENT = 'CURRENT';
export const LEAN_ACCOUNT_SUB_TYPE_SAVINGS = 'SAVINGS';
export const LEAN_CURRENCY_SAR = 'SAR';
export const LEAN_CREDIT_DEBIT_INDICATOR_CREDIT = 'CREDIT';
export const LEAN_CREDIT_DEBIT_INDICATOR_DEBIT = 'DEBIT';
export const LEAN_BALANCE_TYPE_INTERIM_AVAILABLE = 'INTERIM_AVAILABLE';
export const LEAN_BALANCE_TYPE_CLOSING_AVAILABLE = 'CLOSING_AVAILABLE';
export const LEAN_TRANSACTION_STATUS_BOOKED = 'BOOKED';
export const LEAN_ACCOUNT_SCHEME_IBAN = 'IBAN';

/** The data API's largest page; the export reads transactions in pages of this size. */
export const LEAN_DATA_PAGE_SIZE = 100;
/** Pages of transactions the export reads per account before it stops. */
export const LEAN_DATA_MAX_PAGES_PER_ACCOUNT = 50;

export const LEAN_EVENT_ENTITY_CREATED = 'entity.created';
export const LEAN_EVENT_ENTITY_UPDATED = 'entity.updated';
export const LEAN_EVENT_ENTITY_DATA_REFRESH_UPDATED = 'entity.data.refresh.updated';

export const LEAN_REFRESH_STATUS_PENDING = 'PENDING';
export const LEAN_REFRESH_STATUS_FINISHED = 'FINISHED';

/**
 * Per-type values in `data_status`. Lean's own pages disagree on the success word — the webhook
 * library says `SUCCESS`, the data-workflow guide says `OK` — so the adapter accepts both, and
 * `PARTIAL` for transactions.
 */
export const LEAN_DATA_STATUS_SUCCESS = 'SUCCESS';
export const LEAN_DATA_STATUS_OK = 'OK';
export const LEAN_DATA_STATUS_PARTIAL = 'PARTIAL';

export const LEAN_USABLE_DATA_STATUSES: readonly string[] = [
  LEAN_DATA_STATUS_SUCCESS,
  LEAN_DATA_STATUS_OK,
  LEAN_DATA_STATUS_PARTIAL,
];

export const LEAN_INCOME_TYPE_ALL = 'ALL';

/** `async=false` makes the insights endpoints answer in the same request. */
export const LEAN_ASYNC_DISABLED = 'false';

/**
 * The `leanReason` in the metadata of a `rejected` result from `lean_iban_verification`. It is for
 * the audit trail only; the result's `reason` is always `CONNECTOR_REJECTED`, which is what a
 * workflow routes on.
 */
export const LEAN_REJECTION_IBAN_OWNERSHIP_NOT_VERIFIED = 'iban_ownership_not_verified';
export const LEAN_REJECTION_IBAN_NOT_VERIFIABLE = 'iban_not_verifiable';

/** The `lean_bank_data` callback fields, as the `bank_connect` step declares them. */
export const LEAN_FIELD_LEAN_CUSTOMER_ID = 'leanCustomerId';
export const LEAN_FIELD_BANK_CONNECT_OUTCOME = 'bankConnectOutcome';
export const LEAN_FIELD_SALARY_MONTHLY_AVERAGE = 'salaryMonthlyAverage';
export const LEAN_FIELD_SALARY_MONTHS_DETECTED = 'salaryMonthsDetected';
export const LEAN_FIELD_NON_SALARY_MONTHLY_AVERAGE = 'nonSalaryMonthlyAverage';
export const LEAN_FIELD_SALARY_CONSISTENT = 'salaryConsistent';
export const LEAN_FIELD_EMPLOYER_NAME = 'employerName';
export const LEAN_FIELD_SALARY_THRESHOLD_MET = 'salaryThresholdMet';

/** The `lean_bank_data` declaration's `config` key holding the workflow's salary threshold (SAR). */
export const LEAN_CONFIG_MIN_MONTHLY_SALARY = 'minMonthlySalary';
/**
 * The `lean_bank_data` declaration's optional `config` key naming the `file` field of the parked
 * step that receives the exported bank-data document (0050). When set, the step must also declare
 * `bankAccounts`.
 */
export const LEAN_CONFIG_EXPORT_FIELD = 'exportField';
/** The client-visible `json` summary of the exported accounts, for an account-selection page. */
export const LEAN_FIELD_BANK_ACCOUNTS = 'bankAccounts';

export const LEAN_BANK_CONNECT_OUTCOME_CONNECTED = 'connected';
export const LEAN_BANK_CONNECT_OUTCOME_DATA_UNAVAILABLE = 'data_unavailable';
export const LEAN_BANK_CONNECT_OUTCOME_NOT_CONNECTED = 'not_connected';

export type LeanBankConnectOutcome =
  | typeof LEAN_BANK_CONNECT_OUTCOME_CONNECTED
  | typeof LEAN_BANK_CONNECT_OUTCOME_DATA_UNAVAILABLE
  | typeof LEAN_BANK_CONNECT_OUTCOME_NOT_CONNECTED;

export type LeanBankDataCallbackFields = {
  bankConnectOutcome: LeanBankConnectOutcome;
  /** SAR, `income.salary.total.average_monthly_amount`; 0 when no salary. */
  salaryMonthlyAverage?: number;
  /** Months of the reporting period with a salary credit. */
  salaryMonthsDetected?: number;
  /** SAR, `income.non_salary.total.average_monthly_amount`. */
  nonSalaryMonthlyAverage?: number;
  /** Any employer with `salary_consistent`. */
  salaryConsistent?: boolean;
  /** `matched_reference_employer.name.en`, else `bank_employer_name`. */
  employerName?: string;
  /** `salaryMonthlyAverage` reached the declaration's `config.minMonthlySalary`. */
  salaryThresholdMet?: boolean;
  /** `{ accounts: [...] }`, set with the export; see `LeanBankAccountsSummary`. */
  bankAccounts?: LeanBankAccountsSummary;
  /** The exported document's id, under the field `config.exportField` names. */
  [exportField: string]: unknown;
};

/** One exported account as the applicant sees it: a position, never an account number. */
export type LeanBankAccountSummary = Readonly<{
  /** `account-01`, `account-02`, …: the account's position in the document. */
  id: string;
  /** The document's `type`: `CHECKING` or `SAVINGS`. */
  type: string;
  name: string;
  /** The last four characters of the IBAN, when Lean reported one. */
  accountNumber: string | null;
  /** In the document's currency, after conversion. */
  balance: number;
  currency: string;
  bankName: string;
}>;

export type LeanBankAccountsSummary = Readonly<{ accounts: readonly LeanBankAccountSummary[] }>;

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_MINUTE = SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const ABANDONED_AFTER_MINUTES = 30;

/** A bank connect with no entity this long after the park is treated as abandoned by the user. */
export const LEAN_CONNECT_ABANDONED_AFTER_MS = ABANDONED_AFTER_MINUTES * MILLISECONDS_PER_MINUTE;

/** How far back the insights calls look; Lean itself defaults the income call to the same span. */
export const LEAN_INSIGHTS_LOOKBACK_MONTHS = 6;

/** Safety margin before `expires_in`, so a token is never used in its last minute. */
export const LEAN_TOKEN_REFRESH_MARGIN_MS = MILLISECONDS_PER_MINUTE;

export type LeanCredentials = Readonly<{ clientId: string; clientSecret: string }>;

/** The body of every 4xx answer. Lean puts the failure's code in `status`, not an HTTP-style one. */
export type LeanErrorBody = Readonly<{
  status: string;
  message: string;
  timestamp?: string;
  results_id?: string;
  metadata?: unknown;
}>;

/** `202`: the insight is still being computed (`results_id` fetches it later). */
export type LeanPendingBody = Readonly<{
  status: typeof LEAN_RESULT_STATUS_PENDING;
  results_id: string;
  message: string;
}>;

export type LeanTokenResponse = Readonly<{
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
}>;

export type LeanVerifyAccountRequest = Readonly<{ iban: string; nationalId: string }>;

export type LeanAccountVerification = Readonly<{
  /** `OK`, or a vocabulary of the verifier's own (`GIVEN_INPUT_CANNOT_BE_VERIFIED`). */
  status: string;
  results_id: string;
  message: string;
  status_detail: Readonly<{
    granular_status_code: string | null;
    status_additional_info: string | null;
  }> | null;
  verifications?: Readonly<{
    account_ownership_verified: boolean;
    /** Present when ownership is not verified: `PARTIAL` or `NO_MATCH`. */
    matching: Readonly<{ type: string; score: number }> | null;
    /** `ACTIVE` on a verified account, `null` on a mismatch. */
    account_status: string | null;
    account_holder_name: string | null;
    verification_method: string;
  }> | null;
}>;

export type LeanCustomer = Readonly<{ customer_id: string; app_user_id: string }>;

/** `GET /customers/v1/` pages by `page`/`size`; the adapters never list customers. */
export type LeanEntity = Readonly<{
  id: string;
  customer_id: string;
  bank_identifier: string;
  created_at: string;
  bank_details?: Readonly<{ name?: string | null; identifier?: string | null }> | null;
}>;

export type LeanAmount = Readonly<{ amount: number; currency: string }>;

/** `GET /data/v2/accounts?entity_id=` → `data.accounts[]`. */
export type LeanAccount = Readonly<{
  account_id: string;
  account_holder_name?: string | null;
  currency: string;
  /** `PERSONAL` or `BUSINESS`. */
  account_type: string;
  /** `CURRENT`, `SAVINGS`, `CREDIT`, `PREPAID`, `EMONEY`, `CHARGE_CARD`, … */
  account_sub_type: string;
  status?: string;
  account?: ReadonlyArray<Readonly<{ scheme_name: string; identification: string }>> | null;
}>;

/** `GET /data/v2/accounts/{account_id}/balances?entity_id=` → `data.balances[]`. */
export type LeanBalance = Readonly<{
  type: string;
  credit_debit_indicator: string;
  amount: LeanAmount;
  date_time?: string | null;
}>;

/** `GET /data/v2/accounts/{account_id}/transactions?entity_id=&page=&size=` → `data.transactions[]`. */
export type LeanTransaction = Readonly<{
  transaction_id?: string;
  amount: LeanAmount;
  credit_debit_indicator: string;
  status?: string;
  booking_date_time?: string | null;
  value_date_time?: string | null;
  transaction_information?: string | null;
  insights?: Readonly<{ description_cleansed?: string | null }> | null;
}>;

export type LeanAccountsResponse = Readonly<{
  data: Readonly<{ accounts: readonly LeanAccount[] }>;
}>;

export type LeanBalancesResponse = Readonly<{
  data: Readonly<{ balances: readonly LeanBalance[] }>;
}>;

export type LeanTransactionsResponse = Readonly<{
  data: Readonly<{
    transactions: readonly LeanTransaction[];
    page?: Readonly<{ total_elements?: number; total_pages?: number }>;
  }>;
}>;

export type LeanTransactionsRequest = Readonly<{
  entityId: string;
  accountId: string;
  /** `YYYY-MM-DD`, both inclusive. */
  startDate: string;
  endDate: string;
  page: number;
}>;

export type LeanIncomeRequest = Readonly<{
  entityId: string;
  /** `YYYY-MM-DD` in UTC. */
  startDate: string;
}>;

export type LeanIncomeCategory = Readonly<{
  currency: string;
  total: Readonly<{ amount: number; count: number; average_monthly_amount: number }>;
  monthly_totals: ReadonlyArray<
    Readonly<{ month: number; year: number; amount: number; count: number }>
  >;
}>;

export type LeanIncome = Readonly<{
  status: string;
  results_id: string;
  insights: Readonly<{ salary?: LeanIncomeCategory; non_salary?: LeanIncomeCategory }>;
}>;

export type LeanEmploymentRequest = LeanIncomeRequest;

export type LeanEmploymentDetails = Readonly<{
  bank_employer_name: string | null;
  matched_reference_employer: Readonly<{
    name: Readonly<{ en: string; ar: string }> | null;
    cr_number: number | null;
  }> | null;
  salary_consistent: boolean | null;
}>;

export type LeanEmployment = Readonly<{
  status: string;
  results_id: string;
  insights: Readonly<{ employment_details: readonly LeanEmploymentDetails[] }>;
}>;
