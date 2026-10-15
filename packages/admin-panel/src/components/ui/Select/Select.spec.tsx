import '@testing-library/jest-dom/vitest';
import { useState, type ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Select, type SelectItem } from './Select';

afterEach(() => {
  cleanup();
});

type Version = '1' | '2' | '3';

const ITEMS: readonly SelectItem<Version>[] = [
  { value: '1', label: 'v1 — retired' },
  { value: '2', label: 'v2 — published' },
  { value: '3', label: 'v3 — draft' },
];

function Harness({
  onChange = vi.fn(),
  disabled,
}: {
  onChange?: (value: Version) => void;
  disabled?: boolean;
}): ReactElement {
  const [value, setValue] = useState<Version | null>('2');
  return (
    <Select
      aria-label="Version"
      items={ITEMS}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('Select', () => {
  it('renders the selected item label and takes its accessible name from aria-label', () => {
    render(<Harness />);

    const trigger = screen.getByRole('combobox', { name: 'Version' });
    expect(trigger).toHaveTextContent('v2 — published');
  });

  it('takes its accessible name from a label pointing at its id', () => {
    render(
      <>
        <label htmlFor="version-select">Source version</label>
        <Select id="version-select" items={ITEMS} value="2" onValueChange={vi.fn()} />
      </>,
    );

    expect(screen.getByRole('combobox', { name: 'Source version' })).toHaveTextContent(
      'v2 — published',
    );
  });

  it('shows the placeholder while nothing is selected', () => {
    render(
      <Select
        aria-label="Version"
        items={ITEMS}
        value={null}
        placeholder="Choose a version"
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Version' })).toHaveTextContent('Choose a version');
  });

  it('calls onValueChange when an option is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole('combobox', { name: 'Version' }));
    await user.click(await screen.findByRole('option', { name: 'v3 — draft' }));

    expect(onChange).toHaveBeenCalledWith('3');
    expect(screen.getByRole('combobox', { name: 'Version' })).toHaveTextContent('v3 — draft');
  });

  it('calls onValueChange when an option is chosen by keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    screen.getByRole('combobox', { name: 'Version' }).focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledWith('3');
  });

  it('does not open when disabled', async () => {
    const user = userEvent.setup();
    render(<Harness disabled />);

    const trigger = screen.getByRole('combobox', { name: 'Version' });
    await user.click(trigger);

    expect(trigger).toHaveAttribute('data-disabled');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
