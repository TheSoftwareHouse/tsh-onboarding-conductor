import { describe, expect, it } from 'vitest';
import { resolveLocalTimeZoneName, toDateTimeLocalValue } from './datetime-local';

describe('toDateTimeLocalValue', () => {
  it('names the local wall-clock minute, zero-padded as the control requires', () => {
    expect(toDateTimeLocalValue(new Date(2026, 6, 2, 9, 5))).toBe('2026-07-02T09:05');
  });

  it('names the local minute rather than the UTC one', () => {
    const date = new Date(2026, 0, 3, 1, 30);
    const expectedHour = String(date.getHours()).padStart(2, '0');

    expect(toDateTimeLocalValue(date)).toBe(`2026-01-03T${expectedHour}:30`);
  });
});

describe('resolveLocalTimeZoneName', () => {
  it('resolves the zone the browser reports', () => {
    expect(resolveLocalTimeZoneName()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
