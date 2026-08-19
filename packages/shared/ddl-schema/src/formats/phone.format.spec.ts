import { phoneFormatDefinition } from './phone.format';

const { name, provider, validate } = phoneFormatDefinition;

describe('phone field format', () => {
  it('declares the registry key and the custom provider', () => {
    expect(name).toBe('phone');
    expect(provider).toBe('custom');
  });

  it('accepts an E.164 number', () => {
    expect(validate('+14155552671')).toBe(true);
    expect(validate('+48123456789')).toBe(true);
  });

  it('accepts 2 to 15 digits and rejects either side of that range', () => {
    expect(validate('+12')).toBe(true);
    expect(validate('+123456789012345')).toBe(true);

    expect(validate('+1')).toBe(false);
    expect(validate('+')).toBe(false);
    expect(validate('+1234567890123456')).toBe(false);
  });

  it('rejects a leading-zero country code', () => {
    expect(validate('+0155552671')).toBe(false);
    // Also at the lower length bound, so the rejection is the [1-9] class and not the length.
    expect(validate('+01')).toBe(false);
  });

  it('requires exactly one leading plus', () => {
    expect(validate('14155552671')).toBe(false);
    expect(validate('++14155552671')).toBe(false);
  });

  it('rejects every character that is not a digit', () => {
    expect(validate('+1415555267a')).toBe(false);
    expect(validate('+1 415 555 2671')).toBe(false);
    expect(validate('+1-415-555-2671')).toBe(false);
    expect(validate('+1(415)5552671')).toBe(false);
    expect(validate('+1.4155552671')).toBe(false);
  });

  it('does not normalize the value, unlike the account-number format', () => {
    expect(validate(' +14155552671')).toBe(false);
    expect(validate('+14155552671 ')).toBe(false);
    // `$` without the `m` flag admits no trailing newline in JavaScript.
    expect(validate('+1415555267\n')).toBe(false);
  });

  it('rejects an empty value', () => {
    expect(validate('')).toBe(false);
  });
});
