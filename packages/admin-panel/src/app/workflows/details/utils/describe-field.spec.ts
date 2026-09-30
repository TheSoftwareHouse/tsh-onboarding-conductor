import { describe, expect, it } from 'vitest';
import type { WorkflowFieldDefinition } from '@/api/workflows/workflow-definitions';
import { describeField } from './describe-field';

function field(overrides: Partial<WorkflowFieldDefinition> = {}): WorkflowFieldDefinition {
  return {
    name: 'f',
    type: 'text',
    required: true,
    persist: true,
    schema: {},
    upload: null,
    ...overrides,
  };
}

describe('describeField', () => {
  it('renders type and presence', () => {
    expect(describeField(field())).toBe('text · required');
    expect(describeField(field({ type: 'boolean', required: false }))).toBe('boolean · optional');
  });

  it('renders a boolean pinned to one value as a requirement', () => {
    expect(describeField(field({ type: 'boolean', schema: { enum: [true] } }))).toBe(
      'boolean · required · must be true',
    );
    expect(describeField(field({ type: 'boolean', schema: { const: false } }))).toBe(
      'boolean · required · must be false',
    );
  });

  it('renders format, enum, length and pattern', () => {
    expect(describeField(field({ schema: { format: 'email' } }))).toBe(
      'text · required · format email',
    );
    expect(describeField(field({ schema: { enum: ['a', 'b', 'c'] } }))).toBe(
      'text · required · oneOf a, b, c',
    );
    expect(describeField(field({ schema: { enum: ['a', 'b', 'c', 'd'] } }))).toBe(
      'text · required · oneOf 4',
    );
    expect(describeField(field({ schema: { minLength: 1, maxLength: 100 } }))).toBe(
      'text · required · 1–100 chars',
    );
    expect(describeField(field({ required: false, schema: { maxLength: 100 } }))).toBe(
      'text · optional · max 100',
    );
    expect(describeField(field({ schema: { pattern: '^[0-9]{4,10}$' } }))).toBe(
      'text · required · ^[0-9]{4,10}$',
    );
  });

  it('renders persist false and required when', () => {
    expect(describeField(field({ persist: false }))).toBe('text · required · persist false');
    expect(describeField(field({ when: { field: 'documentType', equals: 'PASSPORT' } }))).toBe(
      'text · required when documentType = PASSPORT',
    );
  });

  it('renders upload limits', () => {
    expect(
      describeField(
        field({
          type: 'file',
          upload: {
            contentTypes: ['image/png', 'image/jpeg', 'application/pdf'],
            maxSizeBytes: 10 * 1024 * 1024,
          },
        }),
      ),
    ).toBe('file · required · png, jpeg, pdf · max 10 MB');
  });

  it('ignores malformed schema values', () => {
    expect(describeField(field({ schema: { enum: 'x', format: 3, maxLength: 'y' } }))).toBe(
      'text · required',
    );
    expect(describeField(field({ when: 'garbage' }))).toBe('text · required when custom condition');
  });
});
