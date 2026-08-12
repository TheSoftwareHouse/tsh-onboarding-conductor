import { WorkflowInvalidError } from '../workflow-invalid.error';
import {
  BUILT_IN_FIELD_TYPES,
  buildFieldTypeRegistry,
  findFieldType,
  getFieldType,
  listFieldTypes,
} from './field-type.registry';
import { normalizeWorkflowField } from './field.normalizer';

describe('field type registry', () => {
  it('exposes every built-in type exactly once', () => {
    expect(listFieldTypes().map((definition) => definition.type)).toEqual([
      'text',
      'number',
      'boolean',
      'date',
      'file',
      'object',
      'array',
    ]);
    expect(listFieldTypes()).toHaveLength(BUILT_IN_FIELD_TYPES.length);
  });

  it('resolves aliases to their canonical definition', () => {
    expect(getFieldType('string')).toBe(getFieldType('text'));
    expect(getFieldType('string').type).toBe('text');
  });

  it('finds nothing for unknown names and throws on a required lookup', () => {
    expect(findFieldType('money')).toBeUndefined();
    expect(() => getFieldType('money')).toThrow(WorkflowInvalidError);
    expect(() => getFieldType('money')).toThrow(
      expect.objectContaining({ reason: 'INVALID_VALUE' }),
    );
  });

  it('does not resolve prototype keys coming from untrusted workflow JSON', () => {
    expect(findFieldType('__proto__')).toBeUndefined();
    expect(findFieldType('constructor')).toBeUndefined();
    expect(findFieldType('toString')).toBeUndefined();
    expect(() => normalizeWorkflowField({ type: '__proto__', required: true }, 'root')).toThrow(
      WorkflowInvalidError,
    );
  });

  it('declares the levels each type may appear at', () => {
    expect(getFieldType('file').levels).toEqual(['root']);
    expect(getFieldType('text').levels).toEqual(['root', 'nested', 'arrayItem']);
  });

  it('normalizes through the resolved definition', () => {
    expect(normalizeWorkflowField({ type: 'string', required: false }, 'root')).toEqual({
      type: 'text',
      required: false,
      persist: true,
    });
  });

  it('builds an isolated registry from a definition list', () => {
    const registry = buildFieldTypeRegistry([BUILT_IN_FIELD_TYPES[0]]);

    expect(findFieldType('text', registry)?.type).toBe('text');
    expect(findFieldType('number', registry)).toBeUndefined();
    expect(findFieldType('number')).toBeDefined();
  });
});
