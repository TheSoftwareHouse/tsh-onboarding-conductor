import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTimeRangeField, type DateTimeRange } from './DateTimeRangeField';

afterEach(() => {
  cleanup();
});

const EMPTY_RANGE: DateTimeRange = { from: '', to: '' };

function renderRange(
  value: DateTimeRange = EMPTY_RANGE,
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

  it('opens the window at a preset and leaves its far end empty', async () => {
    const onChange = vi.fn();
    renderRange(EMPTY_RANGE, onChange);

    await userEvent.selectOptions(screen.getByLabelText('Occurred'), 'Last 7 days');

    const range = onChange.mock.lastCall?.[0] as DateTimeRange;
    expect(range.to).toBe('');
    const from = new Date(range.from).getTime();
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(from - weekAgo)).toBeLessThan(60 * 1000);
  });

  it('clears both bounds when All time is chosen', async () => {
    const onChange = vi.fn();
    renderRange({ from: '2026-07-01T09:00', to: '' }, onChange);

    await userEvent.selectOptions(screen.getByLabelText('Occurred'), 'All time');

    expect(onChange).toHaveBeenLastCalledWith(EMPTY_RANGE);
  });

  it('reveals the two bound fields on Custom range without changing the value', async () => {
    const onChange = vi.fn();
    renderRange(EMPTY_RANGE, onChange);

    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('To')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Occurred'), 'Custom range…');

    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('mounts on Custom range, fields visible, when the value carries a `to`', () => {
    renderRange({ from: '2026-07-01T09:00', to: '2026-07-02T09:00' });

    expect(screen.getByLabelText('Occurred')).toHaveValue('custom');
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
  });

  it('mounts on Custom range when `from` names no preset instant', () => {
    renderRange({ from: '2026-07-01T09:00', to: '' });

    expect(screen.getByLabelText('Occurred')).toHaveValue('custom');
    expect(screen.getByLabelText('From')).toBeInTheDocument();
  });

  it('mounts on the matching preset when `from` names one of its instants', () => {
    renderRange({ from: '', to: '' });

    expect(screen.getByLabelText('Occurred')).toHaveValue('');
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
  });

  it('disables the select while the list is loading', () => {
    renderRange(EMPTY_RANGE, vi.fn(), true);

    expect(screen.getByLabelText('Occurred')).toBeDisabled();
  });
});
