import { describe, expect, it } from 'vitest';
import {
  buildDefault,
  humanize,
  isEmptyValue,
  kindOfValue,
  listVariants,
  pickVariant,
  readConfigDefaults,
  readDiscriminator,
  readKind,
  resolveSchema,
  type Schema,
} from './config-schema';

describe('readKind', () => {
  it.each<[Schema, string]>([
    [{ type: 'string' }, 'string'],
    [{ type: 'integer' }, 'number'],
    [{ type: 'boolean' }, 'boolean'],
    [{ type: 'array' }, 'array'],
    [{ enum: ['a', 'b'] }, 'enum'],
    [{ const: 'a' }, 'enum'],
    [{ properties: {} }, 'object'],
    [{}, 'unknown'],
  ])('reads %j as %s', (schema, kind) => {
    expect(readKind(schema)).toBe(kind);
  });

  it('resolves an unknown $ref to an empty schema', () => {
    expect(resolveSchema({ $ref: '#/definitions/nope' })).toEqual({});
  });
});

describe('kindOfValue', () => {
  it.each<[unknown, string]>([
    [[], 'array'],
    [{}, 'object'],
    [1, 'number'],
    [true, 'boolean'],
    ['x', 'string'],
    [null, 'unknown'],
  ])('reads %j as %s', (value, kind) => {
    expect(kindOfValue(value)).toBe(kind);
  });
});

describe('humanize', () => {
  it('splits camel case and separators into a sentence', () => {
    expect(humanize('minAgeYears')).toBe('Min age years');
    expect(humanize('code_field')).toBe('Code field');
  });
});

describe('variants', () => {
  const variants: Schema[] = [
    { properties: { type: { const: 'text' } } },
    { properties: { type: { enum: ['date', 'datetime'] } } },
  ];

  it('lists anyOf and oneOf members', () => {
    expect(listVariants({ anyOf: [{ type: 'string' }] })).toEqual([{ type: 'string' }]);
    expect(listVariants({ oneOf: [{ type: 'number' }] })).toEqual([{ type: 'number' }]);
    expect(listVariants({})).toEqual([]);
  });

  it('names each variant by its first accepted tag', () => {
    expect(readDiscriminator(variants)).toEqual(['text', 'date']);
    expect(readDiscriminator([{ type: 'string' }])).toBeNull();
  });

  it('picks the variant by tag, then by kind', () => {
    expect(pickVariant(variants, { type: 'datetime' })).toBe(1);
    expect(pickVariant([{ type: 'string' }, { type: 'number' }], 3)).toBe(1);
    expect(pickVariant([{ type: 'string' }, { type: 'number' }], undefined)).toBe(0);
  });
});

describe('buildDefault', () => {
  it('builds the starting value for each kind', () => {
    expect(buildDefault({ type: 'string' })).toBe('');
    expect(buildDefault({ type: 'number', minimum: 3 })).toBe(3);
    expect(buildDefault({ type: 'boolean' })).toBe(false);
    expect(buildDefault({ enum: ['a', 'b'] })).toBe('a');
    expect(buildDefault({ type: 'array', items: { type: 'string' } })).toEqual([]);
    expect(buildDefault({ type: 'array', items: { type: 'string' }, minItems: 1 })).toEqual(['']);
  });

  it('fills only the required properties of an object', () => {
    expect(
      buildDefault({
        type: 'object',
        required: ['a'],
        properties: { a: { type: 'string' }, b: { type: 'number' } },
      }),
    ).toEqual({ a: '' });
  });

  it('starts from the first variant', () => {
    expect(buildDefault({ anyOf: [{ const: 'x' }, { type: 'string' }] })).toBe('x');
  });

  it('starts a condition from its simplest form', () => {
    expect(buildDefault({ $ref: '#/definitions/condition' })).toEqual({ field: '', isSet: true });
  });
});

describe('isEmptyValue', () => {
  it('treats blank strings, empty collections and undefined as empty', () => {
    expect(isEmptyValue('')).toBe(true);
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue([])).toBe(true);
    expect(isEmptyValue({})).toBe(true);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue(false)).toBe(false);
  });
});

describe('readConfigDefaults', () => {
  it('returns what the engine fills in for the keys left out', () => {
    expect(readConfigDefaults('contact-details', { email: 'optional' })).toEqual({
      phoneNumber: 'required',
    });
  });

  it('returns nothing for a key the config already sets', () => {
    expect(
      readConfigDefaults('contact-details', { email: 'optional', phoneNumber: 'optional' }),
    ).toEqual({});
  });

  it('returns nothing for an unknown type and for custom', () => {
    expect(readConfigDefaults('no-such-type', {})).toEqual({});
    expect(readConfigDefaults('custom', {})).toEqual({});
  });

  it('returns nothing for a config the engine rejects', () => {
    expect(
      readConfigDefaults('contact-details', { email: 'omitted', phoneNumber: 'omitted' }),
    ).toEqual({});
  });
});
