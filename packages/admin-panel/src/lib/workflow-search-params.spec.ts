import { describe, expect, it } from 'vitest';
import { serializeWorkflowVersionSearch } from './workflow-search-params';

describe('serializeWorkflowVersionSearch', () => {
  it('returns a bare query for a null version', () => {
    expect(serializeWorkflowVersionSearch({ version: null })).toBe('');
  });

  it('carries version as the sole query parameter', () => {
    expect(serializeWorkflowVersionSearch({ version: 3 })).toBe('?version=3');
  });
});
