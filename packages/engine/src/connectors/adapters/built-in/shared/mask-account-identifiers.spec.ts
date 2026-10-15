import { maskAccountIdentifiers } from './mask-account-identifiers';

describe('maskAccountIdentifiers', () => {
  it('keeps the last four characters of every account identifier', () => {
    expect(
      maskAccountIdentifiers([
        { id: 'acc-1', iban: 'GB29NWBK60161331926819', bic: 'NWBKGB2L', number: '12345678' },
        { accountNumber: '1234', name: 'Current', details: { iban: 'DE89370400440532013000' } },
      ]),
    ).toEqual([
      { id: 'acc-1', iban: '****6819', bic: '****GB2L', number: '****5678' },
      { accountNumber: '****1234', name: 'Current', details: { iban: '****3000' } },
    ]);
  });
});
