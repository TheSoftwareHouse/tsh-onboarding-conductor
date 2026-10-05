import { KycCountryInvalidError, normalizeAlpha2, toAlpha2, toAlpha3 } from './kyc-country';

describe('kyc-country', () => {
  it.each([
    ['PL', 'POL'],
    ['de', 'DEU'],
    ['  fr  ', 'FRA'],
  ])('converts alpha-2 %j to alpha-3 %s', (alpha2, alpha3) => {
    expect(toAlpha3(alpha2, 'country')).toBe(alpha3);
  });

  it.each([
    ['POL', 'PL'],
    ['deu', 'DE'],
    ['  fra  ', 'FR'],
  ])('converts alpha-3 %j to alpha-2 %s', (alpha3, alpha2) => {
    expect(toAlpha2(alpha3, 'country')).toBe(alpha2);
  });

  it('round-trips every assigned alpha-2 code', () => {
    for (const alpha2 of ['AD', 'GB', 'PL', 'US', 'ZW']) {
      expect(toAlpha2(toAlpha3(alpha2, 'country'), 'country')).toBe(alpha2);
    }
  });

  it.each(['XX', 'ZZ', '', 'POL'])('refuses %j as an alpha-2 code', (value) => {
    expect(() => toAlpha3(value, 'country')).toThrow(KycCountryInvalidError);
  });

  it.each(['XXX', 'ZZZ', '', 'PL'])('refuses %j as an alpha-3 code', (value) => {
    expect(() => toAlpha2(value, 'country')).toThrow(KycCountryInvalidError);
  });

  it('names the offending field and value without echoing anything else', () => {
    expect(() => toAlpha3('XX', 'nationality')).toThrow(/"nationality" value "XX"/);
  });

  it('normalises an alpha-2 code to trimmed upper case and still validates it', () => {
    expect(normalizeAlpha2('  fr ', 'country')).toBe('FR');
    expect(() => normalizeAlpha2('XX', 'country')).toThrow(KycCountryInvalidError);
  });
});
