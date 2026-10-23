import { buildLeanBankDataExport, isExportEmpty, SAR_TO_GBP_RATE } from './lean-bank-data-export';
import type { LeanAccount, LeanBalance, LeanTransaction } from './lean-contract';

const EXPORTED_AT = new Date('2026-10-19T12:00:00.000Z');
const BANK = { id: 'LEA1_SAMAOB_SAU', name: 'Mockbank 1' };

const account = (overrides: Partial<LeanAccount> = {}): LeanAccount => ({
  account_id: 'acc-1',
  account_holder_name: 'Inventory User',
  currency: 'SAR',
  account_type: 'PERSONAL',
  account_sub_type: 'CURRENT',
  status: 'ACTIVE',
  account: [{ scheme_name: 'IBAN', identification: 'SA2810000011100000461309' }],
  ...overrides,
});

const balance = (overrides: Partial<LeanBalance> = {}): LeanBalance => ({
  type: 'INTERIM_AVAILABLE',
  credit_debit_indicator: 'CREDIT',
  amount: { amount: 1000, currency: 'SAR' },
  date_time: '2026-10-18T00:00:00Z',
  ...overrides,
});

const transaction = (overrides: Partial<LeanTransaction> = {}): LeanTransaction => ({
  transaction_id: 'tx-1',
  amount: { amount: 30000, currency: 'SAR' },
  credit_debit_indicator: 'CREDIT',
  status: 'BOOKED',
  booking_date_time: '2026-09-25T00:00:00Z',
  value_date_time: '2026-09-26T00:00:00Z',
  transaction_information: 'PAYROLL PAYMENT Lean Technologies',
  insights: { description_cleansed: 'Income: Payroll deposit' },
  ...overrides,
});

describe('buildLeanBankDataExport', () => {
  it('converts a personal SAR current account into a GBP checking account with its transactions', () => {
    const exported = buildLeanBankDataExport(
      [
        {
          account: account(),
          balances: [
            balance({ type: 'CLOSING_AVAILABLE', amount: { amount: 1, currency: 'SAR' } }),
            balance(),
          ],
          transactions: [
            transaction(),
            transaction({
              transaction_id: 'tx-2',
              credit_debit_indicator: 'DEBIT',
              amount: { amount: 2500, currency: 'SAR' },
              transaction_information: 'RENT',
              value_date_time: null,
            }),
          ],
        },
      ],
      BANK,
      EXPORTED_AT,
    );

    expect(exported.document).toEqual({
      accounts: [
        {
          type: 'CHECKING',
          usage: 'PERSONAL',
          name: 'Current account',
          currency: 'GBP',
          balance: 197,
          balanceDate: '2026-10-18T00:00:00Z',
          bank: BANK,
          owners: [{ name: 'Inventory User' }],
          iban: 'SA2810000011100000461309',
          transactions: [
            {
              amount: 5910,
              currency: 'GBP',
              description: 'PAYROLL PAYMENT Lean Technologies',
              dates: { debitedAt: '2026-09-25T00:00:00Z', bookedAt: '2026-09-26T00:00:00Z' },
            },
            {
              amount: -492.5,
              currency: 'GBP',
              description: 'RENT',
              dates: { debitedAt: '2026-09-25T00:00:00Z' },
            },
          ],
        },
      ],
    });
    expect(exported.summary).toEqual({
      accounts: [
        {
          id: 'account-01',
          type: 'CHECKING',
          name: 'Current account',
          accountNumber: '1309',
          balance: 197,
          currency: 'GBP',
          bankName: 'Mockbank 1',
        },
      ],
    });
    expect(SAR_TO_GBP_RATE).toBe(0.197);
  });

  it('drops accounts that are not personal SAR current or savings and keeps the rest in order', () => {
    const exported = buildLeanBankDataExport(
      [
        {
          account: account({ account_id: 'usd', currency: 'USD' }),
          balances: [],
          transactions: [],
        },
        {
          account: account({ account_id: 'credit', account_sub_type: 'CREDIT' }),
          balances: [],
          transactions: [],
        },
        {
          account: account({ account_id: 'business', account_type: 'BUSINESS' }),
          balances: [],
          transactions: [],
        },
        {
          account: account({ account_id: 'savings', account_sub_type: 'SAVINGS', account: null }),
          balances: [balance({ credit_debit_indicator: 'DEBIT', date_time: null })],
          transactions: [],
        },
        { account: account({ account_id: 'current' }), balances: [], transactions: [] },
      ],
      BANK,
      EXPORTED_AT,
    );

    expect(
      exported.summary.accounts.map((entry) => [entry.id, entry.type, entry.accountNumber]),
    ).toEqual([
      ['account-01', 'SAVINGS', null],
      ['account-02', 'CHECKING', '1309'],
    ]);
    expect(exported.document.accounts[0]).toMatchObject({
      balance: -197,
      balanceDate: EXPORTED_AT.toISOString(),
      name: 'Savings account',
    });
    expect(exported.document.accounts[0].iban).toBeUndefined();
    expect(exported.document.accounts[1].balance).toBe(0);
  });

  it('keeps only booked transactions with a date and an amount', () => {
    const exported = buildLeanBankDataExport(
      [
        {
          account: account(),
          balances: [],
          transactions: [
            transaction({ status: 'PENDING' }),
            transaction({ booking_date_time: null, value_date_time: null }),
            transaction({ transaction_information: '  ', booking_date_time: null }),
          ],
        },
      ],
      BANK,
      EXPORTED_AT,
    );

    expect(exported.document.accounts[0].transactions).toEqual([
      {
        amount: 5910,
        currency: 'GBP',
        description: 'Transaction',
        dates: { debitedAt: '2026-09-26T00:00:00Z', bookedAt: '2026-09-26T00:00:00Z' },
      },
    ]);
  });

  it('reports an export with no eligible account as empty', () => {
    const exported = buildLeanBankDataExport(
      [{ account: account({ currency: 'USD' }), balances: [], transactions: [] }],
      BANK,
      EXPORTED_AT,
    );

    expect(isExportEmpty(exported)).toBe(true);
    expect(exported.summary).toEqual({ accounts: [] });
  });
});
