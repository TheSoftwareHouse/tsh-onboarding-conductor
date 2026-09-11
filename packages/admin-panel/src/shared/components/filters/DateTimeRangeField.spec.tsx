import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTimeRangeField, type DateTimeRange } from './DateTimeRangeField';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ALL_TIME: DateTimeRange = { period: '', from: '', to: '' };

function renderRange(
  value: DateTimeRange = ALL_TIME,
  onChange: (range: DateTimeRange) => void = vi.fn(),
  disabled = false,
): void {
  render(
    <DateTimeRangeField
      label="Occurred"
      idPrefix="occurred"
      fromName="occurredFrom"
      toName="occurredTo"
      value={value}
      disabled={disabled}
      onChange={onChange}
    />,
  );
}

describe('DateTimeRangeField', () => {
  it('is reachable by the label the criterion is named after', () => {
    renderRange();

    expect(screen.getByLabelText('Occurred')).toBeInTheDocument();
  });

  it('commits the period itself rather than an instant resolved from it', async () => {
    const onChange = vi.fn();
    renderRange(ALL_TIME, onChange);

    await userEvent.selectOptions(screen.getByLabelText('Occurred'), 'Last 7 days');

    expect(onChange).toHaveBeenLastCalledWith({ period: '7d', from: '', to: '' });
  });

  it('reports the committed period back, whatever the clock has done since', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T12:00:30.000Z'));
    renderRange({ period: '1h', from: '', to: '' });

    expect(screen.getByLabelText('Occurred')).toHaveValue('1h');

    // The window is stated as a period, so no amount of elapsed time can make the control
    // disagree with it - this is what used to drift onto `Custom range…` after a minute.
    vi.setSystemTime(new Date('2026-09-11T18:42:07.000Z'));
    cleanup();
    renderRange({ period: '1h', from: '', to: '' });

    expect(screen.getByLabelText('Occurred')).toHaveValue('1h');
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
  });

  it('clears the window when All time is chosen', async () => {
    const onChange = vi.fn();
    renderRange({ period: '24h', from: '', to: '' }, onChange);

    await userEvent.selectOptions(screen.getByLabelText('Occurred'), 'All time');

    expect(onChange).toHaveBeenLastCalledWith(ALL_TIME);
  });

  it('drops the bounds when a period replaces a custom window, so the two never both apply', async () => {
    const onChange = vi.fn();
    renderRange({ period: 'custom', from: '2026-07-01T09:00', to: '2026-07-02T09:00' }, onChange);

    await userEvent.selectOptions(screen.getByLabelText('Occurred'), 'Last hour');

    expect(onChange).toHaveBeenLastCalledWith({ period: '1h', from: '', to: '' });
  });

  it('reveals the two bound fields on Custom range, keeping the bounds already entered', async () => {
    const onChange = vi.fn();
    renderRange({ period: '', from: '', to: '' }, onChange);

    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Occurred'), 'Custom range…');

    expect(onChange).toHaveBeenLastCalledWith({ period: 'custom', from: '', to: '' });
  });

  it('shows the bounds whenever the window is a custom one', () => {
    renderRange({ period: 'custom', from: '2026-07-01T09:00', to: '' });

    expect(screen.getByLabelText('Occurred')).toHaveValue('custom');
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
  });

  it('keeps the window custom when a bound is set from the calendar', async () => {
    const onChange = vi.fn();
    renderRange({ period: 'custom', from: '', to: '' }, onChange);

    await userEvent.click(screen.getByLabelText('From'));
    const calendar = screen.getByRole('dialog', { name: 'From: choose a date and time' });
    await userEvent.click(within(calendar).getByRole('button', { name: 'Now' }));

    const last = onChange.mock.lastCall?.[0] as DateTimeRange;
    expect(last.period).toBe('custom');
    expect(last.from.length).toBeGreaterThan(0);
  });

  it('disables the select while the list is loading', () => {
    renderRange(ALL_TIME, vi.fn(), true);

    expect(screen.getByLabelText('Occurred')).toBeDisabled();
  });
});
