import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, PAGE_SIZES } from './pagination';
import { parseAsTrimmedString, parseAsPageNumber, parseAsPageSize } from './search-params';

describe('parseAsPageNumber', () => {
  it('parses a page inside the safe-integer range', () => {
    expect(parseAsPageNumber.parse('2')).toBe(2);
  });

  it('parses the first page', () => {
    expect(parseAsPageNumber.parse('1')).toBe(1);
  });

  it('rejects a page of zero', () => {
    expect(parseAsPageNumber.parse('0')).toBeNull();
  });

  it('rejects a negative page', () => {
    expect(parseAsPageNumber.parse('-1')).toBeNull();
  });

  it('rejects a fractional page', () => {
    expect(parseAsPageNumber.parse('1.5')).toBeNull();
  });

  it('rejects a page that is not a number', () => {
    expect(parseAsPageNumber.parse('abc')).toBeNull();
  });

  it('falls back to the default page when absent', () => {
    expect(parseAsPageNumber.defaultValue).toBe(DEFAULT_PAGE);
  });

  it('serializes back to the value the URL should carry', () => {
    expect(parseAsPageNumber.serialize(5)).toBe('5');
  });
});

describe('parseAsPageSize', () => {
  it.each(PAGE_SIZES)('parses an offered page size of %d', (size) => {
    expect(parseAsPageSize.parse(String(size))).toBe(size);
  });

  it('rejects a page size the panel does not offer', () => {
    expect(parseAsPageSize.parse('30')).toBeNull();
  });

  it('falls back to the default page size when absent', () => {
    expect(parseAsPageSize.defaultValue).toBe(DEFAULT_PAGE_SIZE);
  });

  it('serializes back to the value the URL should carry', () => {
    expect(parseAsPageSize.serialize(50)).toBe('50');
  });
});

describe('parseAsTrimmedString', () => {
  it('reads a stated criterion, trimming what the operator typed around it', () => {
    expect(parseAsTrimmedString.parse('base')).toBe('base');
    expect(parseAsTrimmedString.parse('  base  ')).toBe('base');
  });

  it('treats a blank value as no criterion at all, so it never reaches the engine', () => {
    // axios omits a null param but sends an empty string as `key=`, so a link carrying
    // `?workflowId=` has to resolve to absent here rather than downstream.
    expect(parseAsTrimmedString.parse('')).toBeNull();
    expect(parseAsTrimmedString.parse('   ')).toBeNull();
    expect(parseAsTrimmedString.parse('\t\n')).toBeNull();
  });

  it('serializes a criterion as the value itself', () => {
    expect(parseAsTrimmedString.serialize('base')).toBe('base');
  });
});
