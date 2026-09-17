import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDayLabel, formatMonthTitle, startOfMonth } from '@/lib/calendar-month';
import { DateTimePickerField } from './DateTimePickerField';

afterEach(() => {
  cleanup();
});

/**
 * Renders the field as the panel holds it - value in, edited value back - so a sequence of edits
 * builds on the one before it rather than on the value the test started from.
 */
function ControlledField({
  initialValue,
  disabled,
  onChange,
}: {
  initialValue: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <DateTimePickerField
      id="occurred-from-filter"
      name="occurredFrom"
      label="From"
      value={value}
      disabled={disabled}
      describedBy="occurred-error"
      onChange={(next: string) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function renderField(
  value: string,
  onChange: (next: string) => void = vi.fn(),
  disabled = false,
): void {
  render(<ControlledField initialValue={value} disabled={disabled} onChange={onChange} />);
}

function control(): HTMLElement {
  return screen.getByLabelText('From');
}

function calendar(): HTMLElement {
  return screen.getByRole('dialog', { name: 'From: choose a date and time' });
}

/** The day cell for a day of the month currently on show, named as the grid names it. */
function dayCell(day: number, month: Date): HTMLElement {
  const target = new Date(month.getFullYear(), month.getMonth(), day);
  return within(calendar()).getByRole('button', { name: formatDayLabel(target) });
}

describe('DateTimePickerField', () => {
  it('reads as a filled-in filter control rather than as a raw control value', () => {
    renderField('2026-07-02T09:30');

    expect(control()).toHaveValue('2 Jul 2026, 09:30');
    expect(control()).toHaveAttribute('readonly');
    expect(control()).toHaveAttribute('aria-expanded', 'false');
  });

  it('names what an empty bound means instead of showing an empty control', () => {
    renderField('');

    expect(control()).toHaveValue('');
    expect(control()).toHaveAttribute('placeholder', 'Any time');
  });

  it('opens the calendar on the month of the value it already carries', async () => {
    renderField('2026-07-02T09:30');

    await userEvent.click(control());

    expect(within(calendar()).getByText('July 2026')).toBeInTheDocument();
    expect(dayCell(2, new Date(2026, 6, 1))).toHaveAttribute('aria-pressed', 'true');
    expect(control()).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens on the current month when the bound is unset', async () => {
    renderField('');

    await userEvent.click(control());

    expect(within(calendar()).getByText(formatMonthTitle(new Date()))).toBeInTheDocument();
  });

  it('keeps the time of day when another date is chosen', async () => {
    const onChange = vi.fn();
    renderField('2026-07-02T09:30', onChange);

    await userEvent.click(control());
    await userEvent.click(dayCell(18, new Date(2026, 6, 1)));

    expect(onChange).toHaveBeenLastCalledWith('2026-07-18T09:30');
  });

  it('starts the day at midnight when a date is chosen before any time is', async () => {
    const onChange = vi.fn();
    renderField('', onChange);

    await userEvent.click(control());
    await userEvent.click(dayCell(18, startOfMonth(new Date())));

    const chosen = new Date(new Date().getFullYear(), new Date().getMonth(), 18);
    expect(onChange).toHaveBeenLastCalledWith(
      `${chosen.getFullYear()}-${String(chosen.getMonth() + 1).padStart(2, '0')}-18T00:00`,
    );
  });

  it('keeps the date when the time of day is changed', async () => {
    const onChange = vi.fn();
    renderField('2026-07-02T09:30', onChange);

    await userEvent.click(control());
    // Set rather than typed: a time control reports whole `HH:mm` values, not the digits behind
    // them, and jsdom does not implement the segmented editing that produces them.
    fireEvent.change(within(calendar()).getByLabelText('Time'), { target: { value: '17:45' } });

    expect(onChange).toHaveBeenLastCalledWith('2026-07-02T17:45');
    expect(control()).toHaveValue('2 Jul 2026, 17:45');
  });

  it('walks month by month without disturbing the value', async () => {
    const onChange = vi.fn();
    renderField('2026-07-02T09:30', onChange);

    await userEvent.click(control());
    await userEvent.click(within(calendar()).getByRole('button', { name: 'Previous month' }));
    expect(within(calendar()).getByText('June 2026')).toBeInTheDocument();

    await userEvent.click(within(calendar()).getByRole('button', { name: 'Next month' }));
    await userEvent.click(within(calendar()).getByRole('button', { name: 'Next month' }));
    expect(within(calendar()).getByText('August 2026')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers now as one action', async () => {
    const onChange = vi.fn();
    renderField('', onChange);

    await userEvent.click(control());
    await userEvent.click(within(calendar()).getByRole('button', { name: 'Now' }));

    const chosen = onChange.mock.lastCall?.[0] as string;
    expect(Math.abs(new Date(chosen).getTime() - Date.now())).toBeLessThan(60 * 1000);
  });

  it('clears the bound and closes, since clearing settles it', async () => {
    const onChange = vi.fn();
    renderField('2026-07-02T09:30', onChange);

    await userEvent.click(control());
    await userEvent.click(within(calendar()).getByRole('button', { name: 'Clear' }));

    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(control()).toHaveFocus();
  });

  it('clears the bound from the keyboard, as a typed value would be cleared', async () => {
    const onChange = vi.fn();
    renderField('2026-07-02T09:30', onChange);

    control().focus();
    await userEvent.keyboard('{Backspace}');

    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('opens from the keyboard with focus on the day the calendar offers', async () => {
    renderField('2026-07-02T09:30');

    control().focus();
    await userEvent.keyboard('{ArrowDown}');

    expect(dayCell(2, new Date(2026, 6, 1))).toHaveFocus();
  });

  it('moves through the calendar with the arrow keys, crossing into the next month', async () => {
    const onChange = vi.fn();
    renderField('2026-07-30T09:30', onChange);

    control().focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');

    expect(within(calendar()).getByText('August 2026')).toBeInTheDocument();
    expect(dayCell(6, new Date(2026, 7, 1))).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('2026-08-06T09:30');
  });

  it('closes on Escape and hands focus back to the control', async () => {
    renderField('2026-07-02T09:30');

    await userEvent.click(control());
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(control()).toHaveFocus();
  });

  it('closes when the pointer goes elsewhere', async () => {
    renderField('2026-07-02T09:30');

    await userEvent.click(control());
    await userEvent.click(document.body);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cannot be opened while the list is loading', async () => {
    renderField('2026-07-02T09:30', vi.fn(), true);

    expect(control()).toBeDisabled();
    await userEvent.click(control());

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
