import { describe, expect, it } from 'vitest';
import { chooseFilterColumns } from './filter-grid';

describe('chooseFilterColumns', () => {
  it('fills every row for the field counts the panels actually carry', () => {
    expect(chooseFilterColumns(6)).toBe(3);
    expect(chooseFilterColumns(8)).toBe(4);
  });

  it('prefers rows of about four, taken from the counts that divide the fields evenly', () => {
    expect(chooseFilterColumns(2)).toBe(2);
    expect(chooseFilterColumns(3)).toBe(3);
    expect(chooseFilterColumns(4)).toBe(4);
    expect(chooseFilterColumns(5)).toBe(5);
    expect(chooseFilterColumns(9)).toBe(3);
    expect(chooseFilterColumns(10)).toBe(5);
  });

  it('falls back to a row of four when no count divides the fields evenly', () => {
    expect(chooseFilterColumns(7)).toBe(4);
    expect(chooseFilterColumns(11)).toBe(4);
  });

  it('lays a single field out on its own, and answers for an empty panel', () => {
    expect(chooseFilterColumns(1)).toBe(1);
    expect(chooseFilterColumns(0)).toBe(4);
  });
});
