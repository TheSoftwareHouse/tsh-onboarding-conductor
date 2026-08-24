import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTimeQuickRanges, type DateTimeRange } from './DateTimeQuickRanges';

afterEach(() => {
  cleanup();
});

const EMPTY_RANGE: DateTimeRange = { from: '', to: '' };

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function renderShortcuts(
  value: DateTimeRange = EMPTY_RANGE,
  onChange: (range: DateTimeRange) => void = vi.fn(),
  disabled = false,
): void {
  render(
    <DateTimeQuickRanges legend="Occurred" value={value} disabled={disabled} onChange={onChange} />,
  );
}

describe('DateTimeQuickRanges', () => {
  it('names the window it fills in, and the zone its bounds are read in', () => {
    renderShortcuts();

    expect(screen.getByRole('group', { name: `Occurred (${TIME_ZONE})` })).toBeInTheDocument();
  });

  it('opens the window at a quick range and leaves its far end open', async () => {
    const onChange = vi.fn();
    renderShortcuts(EMPTY_RANGE, onChange);

    await userEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));

    const range = onChange.mock.lastCall?.[0] as DateTimeRange;
    expect(range.to).toBe('');
    const from = new Date(range.from).getTime();
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(from - weekAgo)).toBeLessThan(60 * 1000);
  });

  it('offers every window an audit trail is usually read through', () => {
    renderShortcuts();

    for (const label of ['Last hour', 'Last 24 hours', 'Last 7 days', 'Last 30 days']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('clears both bounds at once, and offers nothing to clear while none is set', async () => {
    const onChange = vi.fn();
    renderShortcuts({ from: '2026-07-01T09:00', to: '' }, onChange);

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith(EMPTY_RANGE);

    cleanup();
    renderShortcuts(EMPTY_RANGE);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('leaves nothing operable while the list is loading', () => {
    renderShortcuts({ from: '2026-07-01T09:00', to: '' }, vi.fn(), true);

    expect(screen.getByRole('button', { name: 'Last hour' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });
});
