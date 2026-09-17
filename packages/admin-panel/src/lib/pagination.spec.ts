import { describe, expect, it } from 'vitest';
import { resolvePageJump } from './pagination';

describe('resolvePageJump', () => {
  it('resolves a page inside the reported window as typed', () => {
    expect(resolvePageJump('2', 3)).toBe(2);
  });

  it('ignores the padding a typed value may carry', () => {
    expect(resolvePageJump('  2  ', 3)).toBe(2);
  });

  it('lands on the last page for a number past the end', () => {
    expect(resolvePageJump('99', 3)).toBe(3);
  });

  it('lands on the first page for a number below it', () => {
    expect(resolvePageJump('0', 3)).toBe(1);
  });

  it('leaves the pager alone for a value that names no page', () => {
    expect(resolvePageJump('', 3)).toBeNull();
    expect(resolvePageJump('abc', 3)).toBeNull();
    expect(resolvePageJump('1.5', 3)).toBeNull();
    expect(resolvePageJump('-2', 3)).toBeNull();
  });

  it('still offers a first page for a window the endpoint reported as empty', () => {
    expect(resolvePageJump('1', 0)).toBe(1);
  });
});
