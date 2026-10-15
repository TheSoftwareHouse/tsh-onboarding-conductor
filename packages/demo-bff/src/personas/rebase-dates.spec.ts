import { BankData, rebaseDates } from './rebase-dates';

const TODAY = new Date('2026-11-20T08:15:00.000Z');

function account(balanceDate: string, debitedAt: string) {
  return { balanceDate, transactions: [{ id: 't', dates: { debitedAt } }] };
}

describe('rebaseDates', () => {
  it('moves the newest balanceDate to today at 12:00 UTC', () => {
    const result = rebaseDates(
      { accounts: [account('2026-10-14T12:00:00.000Z', '2026-10-01T12:00:00.000Z')] },
      TODAY,
    );

    expect(result.accounts[0].balanceDate).toBe('2026-11-20T12:00:00.000Z');
  });

  it('preserves the relative gaps between transactions and the balance date', () => {
    const result = rebaseDates(
      { accounts: [account('2026-10-14T12:00:00.000Z', '2026-10-01T12:00:00.000Z')] },
      TODAY,
    );

    expect(result.accounts[0].transactions![0].dates!.debitedAt).toBe('2026-11-07T12:00:00.000Z');
  });

  it('uses the maximum balanceDate across accounts and shifts all of them alike', () => {
    const result = rebaseDates(
      {
        accounts: [
          account('2026-10-10T12:00:00.000Z', '2026-10-09T12:00:00.000Z'),
          account('2026-10-14T12:00:00.000Z', '2026-10-13T12:00:00.000Z'),
        ],
      },
      TODAY,
    );

    expect(result.accounts.map((a) => a.balanceDate)).toEqual([
      '2026-11-16T12:00:00.000Z',
      '2026-11-20T12:00:00.000Z',
    ]);
  });

  it('shifts every date key and leaves unparsable values and other fields alone', () => {
    const input: BankData = {
      accounts: [
        {
          balanceDate: '2026-10-14T12:00:00.000Z',
          balance: 5,
          transactions: [
            { amount: 1, dates: { debitedAt: '2026-10-14T12:00:00.000Z', bookedAt: 'n/a' } },
          ],
        },
      ],
    };

    const result = rebaseDates(input, TODAY);

    expect(result.accounts[0].balance).toBe(5);
    expect(result.accounts[0].transactions![0]).toEqual({
      amount: 1,
      dates: { debitedAt: '2026-11-20T12:00:00.000Z', bookedAt: 'n/a' },
    });
  });

  it('does not mutate its input', () => {
    const input = { accounts: [account('2026-10-14T12:00:00.000Z', '2026-10-01T12:00:00.000Z')] };
    const snapshot = JSON.stringify(input);

    rebaseDates(input, TODAY);

    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('rejects a document without a parsable balanceDate', () => {
    expect(() => rebaseDates({ accounts: [] }, TODAY)).toThrow('parsable balanceDate');
  });
});
