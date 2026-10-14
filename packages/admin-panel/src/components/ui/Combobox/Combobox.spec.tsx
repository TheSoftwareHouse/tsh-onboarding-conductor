import '@testing-library/jest-dom/vitest';
import { useState, type ReactElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Combobox,
  type ComboboxInputReason,
  type ComboboxItem,
  type ComboboxProps,
} from './Combobox';

afterEach(() => {
  cleanup();
});

const ITEMS: ComboboxItem[] = [
  { value: 'alpha', label: 'Alpha flow', description: 'alpha · users' },
  { value: 'beta', label: 'Beta flow' },
];

type Overrides = Partial<ComboboxProps> & {
  onInput?: (text: string, reason: ComboboxInputReason) => void;
};

function Harness({ onInput, ...props }: Overrides): ReactElement {
  const [value, setValue] = useState<ComboboxItem | null>(null);
  const [text, setText] = useState('');
  return (
    <Combobox
      aria-label="Workflow"
      items={ITEMS}
      value={value}
      onValueChange={setValue}
      inputValue={text}
      onInputValueChange={(next, reason) => {
        setText(next);
        onInput?.(next, reason);
      }}
      {...props}
    />
  );
}

describe('Combobox', () => {
  it('reports typed text through onInputValueChange', async () => {
    const onInput = vi.fn();
    render(<Harness onInput={onInput} />);

    await userEvent.type(screen.getByRole('combobox', { name: 'Workflow' }), 'be');

    expect(onInput).toHaveBeenLastCalledWith('be', 'input-change');
  });

  it('tells a chosen label apart from typing', async () => {
    const onInput = vi.fn();
    render(<Harness onInput={onInput} />);

    await userEvent.click(screen.getByRole('combobox', { name: 'Workflow' }));
    await userEvent.click(await screen.findByRole('option', { name: /Beta flow/ }));

    expect(onInput).toHaveBeenLastCalledWith('Beta flow', 'item-press');
  });

  it('clears the selection and the text with the clear button', async () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Workflow' });
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();

    await userEvent.click(input);
    await userEvent.click(await screen.findByRole('option', { name: /Beta flow/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(input).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('renders the items as options, without filtering them by the typed text', async () => {
    render(<Harness />);

    await userEvent.type(screen.getByRole('combobox', { name: 'Workflow' }), 'zzz');

    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Alpha flowalpha · users',
      'Beta flow',
    ]);
  });

  it('selects an option by click and shows its label', async () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Workflow' });

    await userEvent.click(input);
    await userEvent.click(await screen.findByRole('option', { name: /Beta flow/ }));

    expect(input).toHaveValue('Beta flow');
  });

  it('selects an option by keyboard', async () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Workflow' });

    await userEvent.click(input);
    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(input).toHaveValue('Alpha flow');
  });

  it('shows the loading row', async () => {
    render(<Harness items={[]} loading loadingText="Searching…" />);

    await userEvent.click(screen.getByRole('combobox', { name: 'Workflow' }));

    expect(await screen.findByText('Searching…')).toBeInTheDocument();
    expect(screen.queryByText('No results')).not.toBeInTheDocument();
  });

  it('shows the empty row when there are no items', async () => {
    render(<Harness items={[]} emptyText="Nothing found" />);

    await userEvent.click(screen.getByRole('combobox', { name: 'Workflow' }));

    expect(await screen.findByText('Nothing found')).toBeInTheDocument();
  });

  it('shows the error row instead of the empty row', async () => {
    render(<Harness items={[]} error="Could not load workflows" />);

    await userEvent.click(screen.getByRole('combobox', { name: 'Workflow' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load workflows');
    expect(screen.queryByText('No results')).not.toBeInTheDocument();
  });

  it('disables the input', () => {
    render(<Harness disabled />);

    expect(screen.getByRole('combobox', { name: 'Workflow' })).toBeDisabled();
  });

  it('asks for more when the list is scrolled to its end, and not before', async () => {
    const onLoadMore = vi.fn();
    render(<Harness onLoadMore={onLoadMore} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Workflow' }));
    // The popup is the scrolling element around the listbox.
    const popup = (await screen.findByRole('listbox')).parentElement as HTMLElement;
    Object.defineProperties(popup, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 200 },
    });

    popup.scrollTop = 100;
    fireEvent.scroll(popup);
    expect(onLoadMore).not.toHaveBeenCalled();

    popup.scrollTop = 290;
    fireEvent.scroll(popup);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
