import { describe, expect, it } from 'vitest';
import { listStepTypes, STEP_TYPE } from '@tsh/ddl-schema/step-types';
import { addStep } from './authored-edits';
import { checkConfig, checkStepConfig } from './check-config';

describe('checkConfig', () => {
  it('flags a missing required member at its path', () => {
    const schema = { type: 'object', required: ['url'], properties: { url: { type: 'string' } } };

    expect(checkConfig(schema, {})).toEqual({ url: 'Required' });
    expect(checkConfig(schema, { url: 'a' })).toEqual({});
  });

  it.each([
    [{ type: 'string' }, 1, 'Must be text'],
    [{ type: 'number' }, 'x', 'Must be a number'],
    [{ type: 'integer' }, 1.5, 'Must be a whole number'],
    [{ type: 'boolean' }, 'yes', 'Must be yes or no'],
    [{ type: 'array' }, {}, 'Must be a list'],
    [{ type: 'object' }, [], 'Must be an object'],
  ])('flags a wrong type for %j', (schema, value, reason) => {
    expect(checkConfig({ properties: { a: schema } }, { a: value })).toEqual({ a: reason });
  });

  it('flags a value outside enum and const', () => {
    const schema = { properties: { a: { enum: ['x', 'y'] }, b: { const: 'k' } } };

    expect(checkConfig(schema, { a: 'z', b: 'j' })).toEqual({
      a: 'Not one of the allowed values',
      b: 'Not one of the allowed values',
    });
    expect(checkConfig(schema, { a: 'x', b: 'k' })).toEqual({});
  });

  it('flags a string shorter than minLength', () => {
    const schema = { properties: { a: { type: 'string', minLength: 1 } } };

    expect(checkConfig(schema, { a: '' })).toEqual({ a: 'Must not be empty' });
    expect(checkConfig({ properties: { a: { minLength: 3 } } }, { a: 'ab' })).toEqual({
      a: 'At least 3 characters',
    });
  });

  it.each([
    [{ minimum: 100, maximum: 30000 }, 99, 'Must be 100–30000'],
    [{ minimum: 100, maximum: 30000 }, 30001, 'Must be 100–30000'],
    [{ minimum: 1 }, 0, 'Must be at least 1'],
    [{ maximum: 5 }, 6, 'Must be at most 5'],
  ])('flags a number outside %j', (bounds, value, reason) => {
    const schema = { properties: { a: { type: 'integer', ...bounds } } };

    expect(checkConfig(schema, { a: value })).toEqual({ a: reason });
  });

  it('accepts a number on its bounds', () => {
    const schema = { properties: { a: { type: 'integer', minimum: 1, maximum: 5 } } };

    expect(checkConfig(schema, { a: 1 })).toEqual({});
    expect(checkConfig(schema, { a: 5 })).toEqual({});
  });

  it('flags a string that does not match the pattern', () => {
    const schema = { properties: { a: { type: 'string', pattern: '^[a-z]+$' } } };

    expect(checkConfig(schema, { a: 'A1' })).toEqual({ a: 'Does not match the required format' });
    expect(checkConfig(schema, { a: 'ab' })).toEqual({});
  });

  it('flags a list shorter than minItems', () => {
    const schema = { properties: { a: { type: 'array', minItems: 1 } } };

    expect(checkConfig(schema, { a: [] })).toEqual({ a: 'Add at least 1 entry' });
    expect(checkConfig({ properties: { a: { minItems: 2 } } }, { a: [1] })).toEqual({
      a: 'Add at least 2 entries',
    });
  });

  it('flags duplicate entries under uniqueItems', () => {
    const schema = { properties: { a: { type: 'array', uniqueItems: true } } };

    expect(checkConfig(schema, { a: ['x', 'x'] })).toEqual({ a: 'Entries must be unique' });
    expect(checkConfig(schema, { a: [{ k: 1 }, { k: 1 }] })).toEqual({
      a: 'Entries must be unique',
    });
    expect(checkConfig(schema, { a: ['x', 'y'] })).toEqual({});
  });

  it('reaches nested objects and array entries with dotted and indexed paths', () => {
    const schema = {
      type: 'object',
      properties: {
        request: {
          type: 'object',
          required: ['url'],
          properties: { timeoutMs: { type: 'integer', minimum: 100 } },
        },
        docs: {
          type: 'array',
          items: { type: 'object', required: ['type'], properties: { type: { type: 'string' } } },
        },
      },
    };

    expect(checkConfig(schema, { request: { timeoutMs: 5 }, docs: [{ type: 'a' }, {}] })).toEqual({
      'request.url': 'Required',
      'request.timeoutMs': 'Must be at least 100',
      'docs[1].type': 'Required',
    });
  });

  it('checks every entry of a map against its value schema', () => {
    const schema = {
      properties: { m: { type: 'object', additionalProperties: { type: 'string' } } },
    };

    expect(checkConfig(schema, { m: { a: 'x', b: 2 } })).toEqual({ 'm.b': 'Must be text' });
  });

  it('checks the variant the value matches', () => {
    const schema = {
      properties: {
        a: {
          anyOf: [
            { type: 'string', minLength: 1 },
            { type: 'array', items: { type: 'string' } },
          ],
        },
      },
    };

    expect(checkConfig(schema, { a: '' })).toEqual({ a: 'Must not be empty' });
    expect(checkConfig(schema, { a: ['x'] })).toEqual({});
    expect(checkConfig(schema, { a: [1] })).toEqual({ 'a[0]': 'Must be text' });
  });

  it('ignores a member the schema does not declare and an unset optional one', () => {
    const schema = { properties: { a: { type: 'string' } } };

    expect(checkConfig(schema, { other: 1 })).toEqual({});
  });
});

describe('checkStepConfig', () => {
  it('names the failing setting of a real step type', () => {
    expect(
      checkStepConfig(STEP_TYPE.httpCall, {
        request: { method: 'POST', url: 'https://x.test', timeoutMs: 5 },
      }),
    ).toEqual({ 'request.timeoutMs': 'Must be 100–30000' });
  });

  it('checks nothing for a type with no schema', () => {
    expect(checkStepConfig('nope', { a: 1 })).toEqual({});
  });

  it.each(listStepTypes().map((definition) => definition.type))(
    'passes the %s starter config',
    (type) => {
      const { doc } = addStep({ id: 'wf', steps: [] }, type, { x: 0, y: 0 });

      expect(checkStepConfig(type, doc.steps[0]?.config ?? {})).toEqual({});
    },
  );
});
