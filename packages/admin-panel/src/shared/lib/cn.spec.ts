import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('resolves a conflict in favour of the last utility', () => {
    expect(cn('px-5', 'px-6')).toBe('px-6');
  });

  it('flattens conditionals the way clsx does', () => {
    const hidden = false;

    expect(
      cn('h-10', hidden && 'hidden', ['px-5', { 'text-fg-3': true, 'text-fg-4': false }]),
    ).toBe('h-10 px-5 text-fg-3');
  });

  it('keeps a caller class that conflicts with nothing', () => {
    expect(cn('h-10 px-5', 'ml-auto')).toBe('h-10 px-5 ml-auto');
  });

  /* The two cases the extended config exists for, each asserting the side that would be lost. */
  it('does not mistake one of our font sizes for a text colour', () => {
    expect(cn('text-body-2xs', 'text-tsh-black')).toBe('text-body-2xs text-tsh-black');
    expect(cn('text-caps-tiny', 'text-fg-3')).toBe('text-caps-tiny text-fg-3');
  });

  it('still resolves two of our font sizes against each other', () => {
    expect(cn('text-body-sm', 'text-caps-tiny')).toBe('text-caps-tiny');
  });

  it('resolves the fractional spacing steps the design uses', () => {
    expect(cn('px-2.5', 'px-3')).toBe('px-3');
    expect(cn('gap-1.5', 'gap-4')).toBe('gap-4');
  });

  it('does not treat min-height as a conflict with height', () => {
    expect(cn('min-h-6', 'h-10')).toBe('min-h-6 h-10');
  });

  it('resolves the named durations, including against Tailwind own numeric ones', () => {
    expect(cn('duration-fast', 'duration-base')).toBe('duration-base');
    expect(cn('duration-fast', 'duration-200')).toBe('duration-200');
  });

  it('resolves the header height against another height', () => {
    expect(cn('h-header', 'h-10')).toBe('h-10');
  });
});
