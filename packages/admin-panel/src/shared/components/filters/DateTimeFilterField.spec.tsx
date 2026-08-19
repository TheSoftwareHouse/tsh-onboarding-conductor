import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTimeFilterField } from './DateTimeFilterField';

afterEach(() => {
  cleanup();
});

describe('DateTimeFilterField', () => {
  it('offers a datetime control and reports the value the browser produced', async () => {
    const onChange = vi.fn();
    render(
      <DateTimeFilterField
        id="occurred-from-filter"
        name="occurredFrom"
        label="Occurred from"
        value=""
        disabled={false}
        onChange={onChange}
      />,
    );

    const input = screen.getByLabelText('Occurred from');
    expect(input).toHaveAttribute('type', 'datetime-local');

    await userEvent.type(input, '2026-07-02T09:00');

    expect(onChange).toHaveBeenLastCalledWith('2026-07-02T09:00');
  });

  it('lets both bounds of a refused window point at the one panel message', () => {
    render(
      <DateTimeFilterField
        id="occurred-to-filter"
        name="occurredTo"
        label="Occurred to"
        value=""
        disabled={false}
        describedBy="occurred-error"
        invalid
        onChange={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Occurred to');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'occurred-error');
  });
});
