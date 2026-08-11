import {
  FIELD_FORMAT_DEFINITIONS,
  WORKFLOW_FIELD_FORMATS,
  findFieldFormat,
} from './field-format.registry';

describe('field format registry', () => {
  it('exposes every declared format exactly once, in enum order', () => {
    expect(WORKFLOW_FIELD_FORMATS).toEqual(['email', 'account-number', 'uuid', 'uri', 'phone']);
    expect(new Set(WORKFLOW_FIELD_FORMATS).size).toBe(WORKFLOW_FIELD_FORMATS.length);
  });

  it('marks custom formats with a predicate and provided formats without one', () => {
    for (const definition of FIELD_FORMAT_DEFINITIONS) {
      if (definition.provider === 'custom') {
        expect(typeof definition.validate).toBe('function');
      } else {
        expect(definition).not.toHaveProperty('validate');
      }
    }
  });

  it('validates account numbers with the IBAN mod-97 checksum', () => {
    const accountNumber = findFieldFormat('account-number');

    expect(accountNumber?.validate?.('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(accountNumber?.validate?.('GB82WEST12345698765432')).toBe(true);
    expect(accountNumber?.validate?.('GB82WEST12345698765433')).toBe(false);
    expect(accountNumber?.validate?.('TOO-SHORT')).toBe(false);
  });

  it('validates phone numbers against strict E.164', () => {
    const phone = findFieldFormat('phone');

    expect(phone?.validate?.('+14155552671')).toBe(true);
    expect(phone?.validate?.('+0155552671')).toBe(false);
    expect(phone?.validate?.('14155552671')).toBe(false);
  });

  it('does not resolve unknown or prototype keys', () => {
    expect(findFieldFormat('unknown')).toBeUndefined();
    expect(findFieldFormat('__proto__')).toBeUndefined();
    expect(findFieldFormat('constructor')).toBeUndefined();
    expect(findFieldFormat('toString')).toBeUndefined();
  });
});
