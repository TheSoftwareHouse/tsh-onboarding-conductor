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

    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('All');
    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'All',
      'Approved',
      'Rejected',
    ]);

    await userEvent.click(await screen.findByRole('option', { name: 'Rejected' }));

    expect(onChange).toHaveBeenLastCalledWith('rejected');
  });

  it('reports an empty value when the option that disables the criterion is picked', async () => {
    const onChange = vi.fn();
    render(
      <SelectFilterField
        id="status-filter"
        name="status"
        label="Status"
        value="rejected"
        options={OPTIONS}
        disabled={false}
        anyOptionLabel="All"
        onChange={onChange}
      />,
    );

    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));
    await userEvent.click(await screen.findByRole('option', { name: 'All' }));

    expect(onChange).toHaveBeenLastCalledWith('');
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

    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Rejected');
  });

  it('omits the disabling option for a select that always narrows', async () => {
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

    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));

    expect(await screen.findAllByRole('option')).toHaveLength(2);
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
