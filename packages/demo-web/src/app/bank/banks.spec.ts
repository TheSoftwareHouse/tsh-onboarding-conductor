import { describe, expect, it } from 'vitest';

import { ALL_BANKS, filterBanks, initials, SUGGESTED_BANKS, TEST_BANK } from './banks';

describe('banks', () => {
  it('should keep every id within the engine pattern and unique', () => {
    const ids = [TEST_BANK, ...ALL_BANKS].map((bank) => bank.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('should list every suggestion in the full list', () => {
    for (const bank of SUGGESTED_BANKS) {
      expect(ALL_BANKS).toContainEqual(bank);
    }
  });

  it('should filter by name case-insensitively when searching', () => {
    expect(filterBanks(ALL_BANKS, 'bARC').map((bank) => bank.name)).toEqual(['Barclays']);
    expect(filterBanks(ALL_BANKS, '  ')).toHaveLength(ALL_BANKS.length);
    expect(filterBanks(ALL_BANKS, 'zzz')).toEqual([]);
  });

  it('should derive up to two initials', () => {
    expect(initials('HSBC UK')).toBe('HU');
    expect(initials('Monzo')).toBe('M');
    expect(initials('The Co-operative Bank')).toBe('CB');
  });
});
