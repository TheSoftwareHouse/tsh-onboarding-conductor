import { describe, expect, it } from 'vitest';
import { formatDate, formatLogDateTime } from './format-date-time';

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

describe('formatDate', () => {
  it('renders a 3-letter month, not `Intl`\'s en-GB "Sept"', () => {
    expect(formatDate('2026-09-22T12:00:00.000Z')).toBe('22 Sep 2026');
  });

  it('returns the Invalid date sentinel for an unparseable value', () => {
    expect(formatDate('not-a-date')).toBe('Invalid date');
  });
});
