import { describe, expect, it } from 'vitest';
import { formatDuration } from './format-duration';

describe('formatDuration', () => {
  it('renders days and hours, the largest two units', () => {
    expect(formatDuration('2026-09-01T09:14:00.000Z', '2026-09-04T11:14:00.000Z')).toBe('3 d 2 h');
  });

  it('renders hours and minutes when under a day', () => {
    expect(formatDuration('2026-09-01T09:14:00.000Z', '2026-09-01T13:26:00.000Z')).toBe('4 h 12 m');
  });

  it('renders minutes alone when under an hour', () => {
    expect(formatDuration('2026-09-01T09:14:00.000Z', '2026-09-01T09:26:00.000Z')).toBe('12 m');
  });

  it('renders the below-a-minute sentinel', () => {
    expect(formatDuration('2026-09-01T09:14:00.000Z', '2026-09-01T09:14:45.000Z')).toBe('< 1 m');
  });

  it('drops a zero middle unit rather than zero-padding it', () => {
    expect(formatDuration('2026-09-01T09:14:00.000Z', '2026-09-02T09:14:00.000Z')).toBe('1 d');
  });

  it('returns NOT_SET for a reversed range', () => {
    expect(formatDuration('2026-09-04T13:14:00.000Z', '2026-09-01T09:14:00.000Z')).toBe('-');
  });

  it('returns NOT_SET for an unparseable date', () => {
    expect(formatDuration('not-a-date', '2026-09-01T09:14:00.000Z')).toBe('-');
  });
});
