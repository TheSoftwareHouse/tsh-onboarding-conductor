import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilterPanel, type FilterPanelProps } from './FilterPanel';

function renderPanel(overrides: Partial<FilterPanelProps> = {}): {
  onSubmit: FilterPanelProps['onSubmit'];
  onReset: FilterPanelProps['onReset'];
  onReload: FilterPanelProps['onReload'];
} {
  const handlers = {
    onSubmit: vi.fn((event) => event.preventDefault()),
    onReset: vi.fn(),
    onReload: vi.fn(),
  };

  render(
    <FilterPanel
      label="Filter things"
      activeCount={0}
      disabled={false}
      {...handlers}
      {...overrides}
    >
      <label htmlFor="thing-filter">Thing</label>
      <input id="thing-filter" name="thing" />
    </FilterPanel>,
  );

  return handlers;
}

afterEach(() => {
  cleanup();
});

describe('FilterPanel', () => {
  it('names the form after the list it narrows and renders the shared actions', () => {
    renderPanel();

    expect(screen.getByRole('form', { name: 'Filter things' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply filters' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeEnabled();
  });

  it('summarises how many criteria are active, and says nothing when none are', () => {
    renderPanel({ activeCount: 0 });
    expect(screen.queryByText(/active/)).not.toBeInTheDocument();

    cleanup();
    renderPanel({ activeCount: 3 });
    expect(screen.getByText('3 active')).toBeInTheDocument();
  });

  // The note describes the URL carrying criteria, so an unfiltered list has nothing to share.
  it('offers the shareable-link note only while criteria are active', () => {
    renderPanel({ activeCount: 0 });
    expect(screen.queryByText('Saved as a shareable link')).not.toBeInTheDocument();

    cleanup();
    renderPanel({ activeCount: 1 });
    expect(screen.getByText('Saved as a shareable link')).toBeInTheDocument();
  });

  it('reports each action to its own handler', async () => {
    const { onSubmit, onReset, onReload } = renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('disables every action while a request is in flight', () => {
    renderPanel({ disabled: true });

    expect(screen.getByRole('button', { name: 'Apply filters' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeDisabled();
  });

  it('keeps the message element mounted while the criteria are valid, so a control can point at it', () => {
    renderPanel({ error: { id: 'thing-error', message: null } });

    const message = document.querySelector('#thing-error');
    expect(message).toBeInTheDocument();
    expect(message).not.toBeVisible();
  });

  it('shows the refusal once the criteria are rejected', () => {
    renderPanel({ error: { id: 'thing-error', message: 'Enter a valid thing.' } });

    expect(screen.getByText('Enter a valid thing.', { selector: '#thing-error' })).toBeVisible();
  });

  it('shows a section shortcut in its header, beside the panel title', () => {
    renderPanel({ shortcuts: <button type="button">Last hour</button> });

    expect(screen.getByRole('button', { name: 'Last hour' })).toBeInTheDocument();
  });

  it('lays the fields out in a grid that wraps rather than clipping a criterion', () => {
    render(
      <FilterPanel
        label="Filter six things"
        activeCount={0}
        disabled={false}
        onSubmit={vi.fn()}
        onReset={vi.fn()}
        onReload={vi.fn()}
      >
        {[1, 2, 3, 4, 5, 6].map((field) => (
          <input key={field} aria-label={`Thing ${field}`} />
        ))}
      </FilterPanel>,
    );

    // `auto-fit` is what lets a narrow panel drop to fewer columns instead of overflowing.
    const grid = screen.getByLabelText('Thing 1').parentElement;
    expect(grid).toHaveClass('grid-cols-[repeat(auto-fit,minmax(190px,1fr))]');
  });
});
