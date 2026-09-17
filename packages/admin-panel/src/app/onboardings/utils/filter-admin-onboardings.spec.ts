import { describe, expect, it } from 'vitest';
import { isRequestableWorkflowVersion, isValidWorkflowVersion } from './filter-admin-onboardings';

describe('isRequestableWorkflowVersion', () => {
  it('accepts a blank draft, which names no criterion at all', () => {
    expect(isRequestableWorkflowVersion('')).toBe(true);
    expect(isRequestableWorkflowVersion('   ')).toBe(true);
  });

  it('accepts a positive whole number, with or without the operator’s whitespace', () => {
    expect(isRequestableWorkflowVersion('7')).toBe(true);
    expect(isRequestableWorkflowVersion('  7  ')).toBe(true);
  });

  it('refuses anything the endpoint would not accept', () => {
    for (const value of ['0', '-1', '1.2', 'abc']) {
      expect(isRequestableWorkflowVersion(value)).toBe(false);
    }
  });
});

describe('isValidWorkflowVersion', () => {
  it('accepts positive base-10 whole numbers', () => {
    expect(isValidWorkflowVersion('1')).toBe(true);
    expect(isValidWorkflowVersion('007')).toBe(true);
  });

  it('rejects zero, negatives, decimals and non-numeric values', () => {
    for (const value of ['0', '-1', '1.2', 'abc', '']) {
      expect(isValidWorkflowVersion(value)).toBe(false);
    }
  });
});
