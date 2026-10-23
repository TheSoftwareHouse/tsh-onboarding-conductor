import {
  LEAN_ACCOUNT_HOLDER_TYPE_PERSONAL,
  LEAN_ACCOUNT_SCHEME_IBAN,
  LEAN_ACCOUNT_SUB_TYPE_CURRENT,
  LEAN_ACCOUNT_SUB_TYPE_SAVINGS,
  LEAN_BALANCE_TYPE_CLOSING_AVAILABLE,
  LEAN_BALANCE_TYPE_INTERIM_AVAILABLE,
  LEAN_CREDIT_DEBIT_INDICATOR_DEBIT,
  LEAN_CURRENCY_SAR,
  LEAN_TRANSACTION_STATUS_BOOKED,
  type LeanAccount,
  type LeanBalance,
  type LeanBankAccountSummary,
  type LeanBankAccountsSummary,
  type LeanTransaction,
} from './lean-contract';

/**
 * SAR to GBP, mid-market on 2026-10-19. The riyal is pegged to the dollar, so the rate moves with
 * GBP/USD alone. A demo compromise (0050): Algoan's models are per local currency and SAR is not
 * among them, so the document is converted into the currency the `algoan_credit` provider defaults
 * to, at a fixed rate, rather than relabelled.
 */
export const SAR_TO_GBP_RATE = 0.197;
export const EXPORT_DOCUMENT_CURRENCY = 'GBP';

/** The document's account types: Algoan's bring-your-own-data vocabulary. */
export const EXPORT_ACCOUNT_TYPE_CHECKING = 'CHECKING';
export const EXPORT_ACCOUNT_TYPE_SAVINGS = 'SAVINGS';
export const EXPORT_ACCOUNT_USAGE_PERSONAL = 'PERSONAL';

const DECIMALS = 2;
const DECIMAL_SCALE = 10 ** DECIMALS;
const ACCOUNT_ID_PREFIX = 'account-';
const ACCOUNT_ID_DIGITS = 2;
const IBAN_VISIBLE_CHARACTERS = 4;

const ACCOUNT_TYPE_BY_SUB_TYPE: Readonly<Record<string, string>> = {
  [LEAN_ACCOUNT_SUB_TYPE_CURRENT]: EXPORT_ACCOUNT_TYPE_CHECKING,
  [LEAN_ACCOUNT_SUB_TYPE_SAVINGS]: EXPORT_ACCOUNT_TYPE_SAVINGS,
};

const ACCOUNT_NAME_BY_TYPE: Readonly<Record<string, string>> = {
  [EXPORT_ACCOUNT_TYPE_CHECKING]: 'Current account',
  [EXPORT_ACCOUNT_TYPE_SAVINGS]: 'Savings account',
};

/** What the export reads from Lean for one account, before conversion. */
export type LeanExportedAccount = Readonly<{
  account: LeanAccount;
  balances: readonly LeanBalance[];
  transactions: readonly LeanTransaction[];
}>;

export type LeanExportBank = Readonly<{ id: string; name: string }>;

/** One account of the document, in the shape `algoan_credit` validates and submits. */
export type ExportedDocumentAccount = {
  type: string;
  usage: string;
  name: string;
  currency: string;
  balance: number;
  balanceDate: string;
  bank: LeanExportBank;
  owners?: ReadonlyArray<{ name: string }>;
  iban?: string;
  transactions: ReadonlyArray<{
    amount: number;
    currency: string;
    description: string;
    dates: { debitedAt: string; bookedAt?: string };
  }>;
};

export type ExportedDocument = Readonly<{ accounts: readonly ExportedDocumentAccount[] }>;

export type LeanBankDataExport = Readonly<{
  document: ExportedDocument;
  summary: LeanBankAccountsSummary;
}>;

const convertAmount = (amountInSar: number): number =>
  Math.round(amountInSar * SAR_TO_GBP_RATE * DECIMAL_SCALE) / DECIMAL_SCALE;

const signed = (amount: number, creditDebitIndicator: string): number =>
  creditDebitIndicator === LEAN_CREDIT_DEBIT_INDICATOR_DEBIT ? -Math.abs(amount) : Math.abs(amount);

/** Personal SAR current and savings accounts are exported; everything else is dropped unread. */
export const isExportableAccount = (account: LeanAccount): boolean =>
  account.account_type === LEAN_ACCOUNT_HOLDER_TYPE_PERSONAL &&
  account.currency === LEAN_CURRENCY_SAR &&
  Object.prototype.hasOwnProperty.call(ACCOUNT_TYPE_BY_SUB_TYPE, account.account_sub_type);

/** `INTERIM_AVAILABLE`, else `CLOSING_AVAILABLE`, else whatever Lean listed first. */
const pickBalance = (balances: readonly LeanBalance[]): LeanBalance | undefined =>
  balances.find((balance) => balance.type === LEAN_BALANCE_TYPE_INTERIM_AVAILABLE) ??
  balances.find((balance) => balance.type === LEAN_BALANCE_TYPE_CLOSING_AVAILABLE) ??
  balances[0];

const findIban = (account: LeanAccount): string | undefined =>
  account.account?.find((identification) => identification.scheme_name === LEAN_ACCOUNT_SCHEME_IBAN)
    ?.identification;

const buildAccountId = (position: number): string =>
  `${ACCOUNT_ID_PREFIX}${String(position + 1).padStart(ACCOUNT_ID_DIGITS, '0')}`;

const convertTransaction = (
  transaction: LeanTransaction,
): ExportedDocumentAccount['transactions'][number] | undefined => {
  const debitedAt = transaction.booking_date_time ?? transaction.value_date_time;

  if (
    (transaction.status !== undefined && transaction.status !== LEAN_TRANSACTION_STATUS_BOOKED) ||
    typeof debitedAt !== 'string' ||
    typeof transaction.amount?.amount !== 'number'
  ) {
    return undefined;
  }

  const bookedAt = transaction.value_date_time ?? undefined;

  return {
    amount: convertAmount(signed(transaction.amount.amount, transaction.credit_debit_indicator)),
    currency: EXPORT_DOCUMENT_CURRENCY,
    // The raw bank label, which Algoan's categoriser is built for, not Lean's cleansed one.
    description: transaction.transaction_information?.trim() || 'Transaction',
    dates: { debitedAt, ...(bookedAt === undefined ? {} : { bookedAt }) },
  };
};

const convertAccount = (
  exported: LeanExportedAccount,
  bank: LeanExportBank,
  exportedAt: Date,
): ExportedDocumentAccount => {
  const { account } = exported;
  const type = ACCOUNT_TYPE_BY_SUB_TYPE[account.account_sub_type];
  const balance = pickBalance(exported.balances);
  const holderName = account.account_holder_name?.trim();
  const iban = findIban(account);

  return {
    type,
    usage: EXPORT_ACCOUNT_USAGE_PERSONAL,
    name: ACCOUNT_NAME_BY_TYPE[type],
    currency: EXPORT_DOCUMENT_CURRENCY,
    balance:
      balance === undefined
        ? 0
        : convertAmount(signed(balance.amount.amount, balance.credit_debit_indicator)),
    balanceDate: balance?.date_time ?? exportedAt.toISOString(),
    bank,
    ...(holderName ? { owners: [{ name: holderName }] } : {}),
    ...(iban === undefined ? {} : { iban }),
    transactions: exported.transactions.flatMap((transaction) => {
      const converted = convertTransaction(transaction);

      return converted === undefined ? [] : [converted];
    }),
  };
};

const summarize = (
  documentAccount: ExportedDocumentAccount,
  position: number,
): LeanBankAccountSummary => ({
  id: buildAccountId(position),
  type: documentAccount.type,
  name: documentAccount.name,
  accountNumber: documentAccount.iban?.slice(-IBAN_VISIBLE_CHARACTERS) ?? null,
  balance: documentAccount.balance,
  currency: documentAccount.currency,
  bankName: documentAccount.bank.name,
});

/**
 * Lean's accounts, balances and transactions as the bank-data document `algoan_credit` validates
 * (0050): personal SAR current and savings accounts only, in Lean's order, every amount converted
 * to GBP at `SAR_TO_GBP_RATE`, `BOOKED` transactions only, debits negated. The summary names each
 * account by its position in the document, so a later selection carries no account number.
 */
export const buildLeanBankDataExport = (
  accounts: readonly LeanExportedAccount[],
  bank: LeanExportBank,
  exportedAt: Date,
): LeanBankDataExport => {
  const documentAccounts = accounts
    .filter((exported) => isExportableAccount(exported.account))
    .map((exported) => convertAccount(exported, bank, exportedAt));

  return {
    document: { accounts: documentAccounts },
    summary: { accounts: documentAccounts.map(summarize) },
  };
};

/** Whether the export has anything a credit provider could score. */
export const isExportEmpty = (exported: LeanBankDataExport): boolean =>
  exported.document.accounts.length === 0;
