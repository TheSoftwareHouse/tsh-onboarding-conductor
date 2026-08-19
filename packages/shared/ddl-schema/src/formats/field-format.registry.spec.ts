import { accountNumberFormatDefinition } from './account-number.format';
import { findFieldFormat, listFieldFormatNames, listFieldFormats } from './field-format.registry';
import { phoneFormatDefinition } from './phone.format';

describe('field format registry', () => {
  it('exposes every declared format exactly once, in declaration order', () => {
    expect(listFieldFormatNames()).toEqual(['email', 'account-number', 'uuid', 'uri', 'phone']);
    expect(new Set(listFieldFormatNames()).size).toBe(listFieldFormatNames().length);
  });

  it('marks custom formats with a predicate and provided formats without one', () => {
    for (const definition of listFieldFormats()) {
      if (definition.provider === 'custom') {
        expect(typeof definition.validate).toBe('function');
      } else {
        expect(definition).not.toHaveProperty('validate');
      }
    }
  });

  it('lists the definition each format module exports', () => {
    // Identity, not behaviour: `registerCustomFormats` reads `validate` off this list to hand it
    // to `ajv.addFormat`, so what the seam owns is exposing the module's own definition rather
    // than a copy. Each predicate's behaviour is covered in the co-located format specs.
    expect(listFieldFormats()).toContain(accountNumberFormatDefinition);
    expect(listFieldFormats()).toContain(phoneFormatDefinition);
  });

  it('does not resolve unknown or prototype keys', () => {
    expect(findFieldFormat('unknown')).toBeUndefined();
    expect(findFieldFormat('__proto__')).toBeUndefined();
    expect(findFieldFormat('constructor')).toBeUndefined();
    expect(findFieldFormat('toString')).toBeUndefined();
  });
});
