import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectFilterField, toFilterOptions } from './SelectFilterField';

const OPTIONS = [
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

afterEach(() => {
  cleanup();
});

describe('SelectFilterField', () => {
  it('offers the criterion values plus the option that disables it', async () => {
    const onChange = vi.fn();
    render(
      <SelectFilterField
        id="status-filter"
        name="status"
        label="Status"
        value=""
        options={OPTIONS}
        disabled={false}
        anyOptionLabel="All"
        onChange={onChange}
      />,
    );

    const select = screen.getByLabelText('Status');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'All',
      'Approved',
      'Rejected',
    ]);

    await userEvent.selectOptions(select, 'rejected');

    expect(onChange).toHaveBeenLastCalledWith('rejected');
  });

  it('shows the value the caller holds as the chosen option', () => {
    render(
      <SelectFilterField
        id="status-filter"
        name="status"
        label="Status"
        value="rejected"
        options={OPTIONS}
        disabled={false}
        anyOptionLabel="All"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Status')).toHaveValue('rejected');
  });

  it('omits the disabling option for a select that always narrows', () => {
    render(
      <SelectFilterField
        id="status-filter"
        name="status"
        label="Status"
        value="approved"
        options={OPTIONS}
        disabled={false}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('option')).toHaveLength(2);
  });
});

describe('toFilterOptions', () => {
  it('labels every engine-defined value with the same describe function the table uses', () => {
    expect(
      toFilterOptions(['approved', 'rejected'] as const, (value) => value.toUpperCase()),
    ).toEqual([
      { value: 'approved', label: 'APPROVED' },
      { value: 'rejected', label: 'REJECTED' },
    ]);
  });
});
