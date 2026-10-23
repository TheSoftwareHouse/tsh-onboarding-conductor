import { describe, expect, it } from 'vitest';

import { moneyFor } from './money';

describe('moneyFor', () => {
  it('shows pounds as they are on the UK journey', () => {
    const money = moneyFor('uk-algoan');

    expect(money.currency).toBe('GBP');
    expect(money.format(1234.5)).toBe('£1,234.50');
  });

  it('shows riyals converted back at the fixed rate on the KSA journey', () => {
    const money = moneyFor('ksa-lean-algoan');

    expect(money.currency).toBe('SAR');
    expect(money.format(197)).toMatch(/SAR/);
    expect(money.format(197)).toContain('1,000.00');
  });

  it('defaults to pounds when the journey is unknown', () => {
    expect(moneyFor(undefined).currency).toBe('GBP');
  });
});
