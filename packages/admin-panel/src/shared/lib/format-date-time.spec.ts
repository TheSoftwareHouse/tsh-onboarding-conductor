import { describe, expect, it } from 'vitest';
import { formatLogDateTime } from './format-date-time';

describe('formatLogDateTime', () => {
  it('keeps seconds and the year', () => {
    const formatted = formatLogDateTime('2026-09-02T11:48:31.000Z');

    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/:\d{2}:\d{2}$/);
  });

  it('returns the Invalid date sentinel for an unparseable value', () => {
    expect(formatLogDateTime('not-a-date')).toBe('Invalid date');
  });
});
