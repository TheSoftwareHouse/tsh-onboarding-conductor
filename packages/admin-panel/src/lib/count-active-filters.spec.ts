import { describe, expect, it } from 'vitest';
import { countActiveFilters, hasActiveFilters } from './count-active-filters';

describe('countActiveFilters', () => {
  it('counts only the criteria carrying a value', () => {
    expect(countActiveFilters({ status: 'approved', workflowId: '', currentStep: 'collect' })).toBe(
      2,
    );
  });

  it('treats whitespace as blank, since the criterion is trimmed before it is sent', () => {
    expect(countActiveFilters({ workflowId: '   ' })).toBe(0);
  });

  it('ignores the keys the endpoint always receives', () => {
    expect(countActiveFilters({ status: '', limit: 20 }, ['limit'])).toBe(0);
    expect(countActiveFilters({ status: 'approved', limit: 20 }, ['limit'])).toBe(1);
  });

  it('counts a non-string value that is present, such as a chosen version number', () => {
    expect(countActiveFilters({ workflowVersion: 2, currentStep: null })).toBe(1);
  });
});

describe('hasActiveFilters', () => {
  it('reports whether anything narrows the list', () => {
    expect(hasActiveFilters({ status: '', limit: 20 }, ['limit'])).toBe(false);
    expect(hasActiveFilters({ status: 'rejected', limit: 20 }, ['limit'])).toBe(true);
  });
});
