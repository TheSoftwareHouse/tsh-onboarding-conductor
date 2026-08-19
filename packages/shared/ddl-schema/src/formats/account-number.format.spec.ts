import { accountNumberFormatDefinition } from './account-number.format';

const { name, provider, validate } = accountNumberFormatDefinition;

describe('account number field format', () => {
  it('declares the registry key and the custom provider', () => {
    expect(name).toBe('account-number');
    expect(provider).toBe('custom');
  });

  it('accepts a value whose mod-97 checksum matches and rejects one whose check digits do not', () => {
    expect(validate('GB82WEST12345698765432')).toBe(true);
    expect(validate('GB82WEST12345698765433')).toBe(false);

    expect(validate('DE89 3704 0044 0532 0130 00')).toBe(true);
    expect(validate('DE89 3704 0044 0532 0130 01')).toBe(false);
  });

  it('strips whitespace and folds case before checking', () => {
    expect(validate('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(validate(' GB82WEST12345698765432 ')).toBe(true);
    // `\s+` covers runs, tabs and newlines, not only single spaces.
    expect(validate('GB82  WEST\t1234\n5698 7654 32')).toBe(true);
    expect(validate('gb82west12345698765432')).toBe(true);
    expect(validate('Gb82WeSt12345698765432')).toBe(true);
  });

  it('accepts the 15- and 34-character bounds', () => {
    // The shortest IBAN in existence; 34 is the ISO 13616 maximum.
    expect(validate('NO9386011117947')).toBe(true);
    expect(validate('no93 8601 1117 947')).toBe(true);
    expect(validate('NO9486011117947')).toBe(false);

    // Synthetic: check digits computed for the BBAN, not chosen.
    expect(validate('MT79ABCD01234567890123456789012345')).toBe(true);
    expect(validate('MT80ABCD01234567890123456789012345')).toBe(false);
  });

  it('applies the length gate independently of the checksum', () => {
    // Every value here satisfies mod-97 and is rejected on length alone, which is
    // the only way to show the two gates are separate.
    expect(validate('NO698601111794')).toBe(false);
    expect(validate('00000000000054')).toBe(false);
    expect(validate('MT53ABCD012345678901234567890123457')).toBe(false);
  });

  it('measures length after stripping whitespace, not before', () => {
    // Both values sit outside 15..34 characters as typed and inside it once normalized, so they
    // fail if the length gate is ever moved ahead of the strip. The second is simply how a
    // 34-character account number is written by hand.
    expect(validate('0000 0000 0000 54')).toBe(false);
    expect(validate('MT79 ABCD 0123 4567 8901 2345 6789 0123 45')).toBe(true);
  });

  it('converts letters by character code minus 55', () => {
    // A = 10 and Z = 35, the ends of the range. With any other offset these fail. Both are
    // synthetic 18-character values chosen to isolate the mapping — despite the prefix they are
    // not German IBANs, which are always 22 characters.
    expect(validate('DE68AAAA0000000000')).toBe(true);
    expect(validate('DE51ZZZZ0000000000')).toBe(true);

    expect(validate('MT84MALT011000012345MTLCAST001S')).toBe(true);
    expect(validate('LC55HEMM000100010012001200023015')).toBe(true);
  });

  it('rotates the value itself, so a pre-rotated one fails', () => {
    expect(validate('WEST12345698765432GB82')).toBe(false);
  });

  it('rejects punctuation that survives the whitespace strip', () => {
    // The charset gate is a precondition, not just a validity check: without it these
    // reach `BigInt()` with a non-numeric string and it throws instead of returning false.
    expect(validate('GB82-WEST-1234-5698-7654-32')).toBe(false);
    expect(validate('GB82.WEST12345698765432')).toBe(false);
  });

  it('rejects an empty or blank value', () => {
    expect(validate('')).toBe(false);
    expect(validate('   ')).toBe(false);
  });

  it('gates on charset and length only, with no country or check-digit structure', () => {
    // Pins current behaviour and records a known gap rather than endorsing it: a real IBAN is
    // 2 letters + 2 check digits + BBAN, and none of that is enforced, so any string clearing
    // the charset and length gates is accepted at the checksum's own ~1-in-97 rate. Whoever
    // tightens the pattern will see these three lines go red; that is the intended signal.
    expect(validate('000000000000054')).toBe(true);
    expect(validate('9000000000000024')).toBe(true);
    expect(validate('1224ABCD0000000000')).toBe(true);
  });
});
