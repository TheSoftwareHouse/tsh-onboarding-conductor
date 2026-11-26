import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listStepTypes } from '@tsh/ddl-schema/step-types';
import { CanvasPalette } from './CanvasPalette';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPalette(onAdd = vi.fn()): typeof onAdd {
  render(<CanvasPalette onAdd={onAdd} onDragStart={vi.fn()} onDragEnd={vi.fn()} />);
  return onAdd;
}

describe('CanvasPalette', () => {
  it('lists every step type with its description, and hints how to add one', () => {
    renderPalette();

    expect(document.querySelectorAll('button[draggable="true"]')).toHaveLength(
      listStepTypes().length,
    );
    expect(screen.getByText('Collects email and phone; each can be optional.')).toBeVisible();
    expect(screen.getByText(/Click or drag onto the canvas to add a step/)).toBeVisible();
  });

  it('filters by name and by description', async () => {
    renderPalette();
    const search = screen.getByRole('searchbox', { name: 'Search step types' });

    await userEvent.type(search, 'manual-review');
    expect(screen.getByRole('button', { name: /^manual-review/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^terminal/ })).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, 'sms');
    expect(screen.getByRole('button', { name: /^otp-verify/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^terminal/ })).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, 'zzzz');
    expect(screen.getByText('No step type matches.')).toBeVisible();
  });

  it('adds a step on click, and the first match on Enter in the search box', async () => {
    const onAdd = renderPalette();

    await userEvent.click(screen.getByRole('button', { name: /^terminal/ }));
    expect(onAdd).toHaveBeenLastCalledWith('terminal');

    await userEvent.type(screen.getByRole('searchbox'), 'manual-review{Enter}');
    expect(onAdd).toHaveBeenLastCalledWith('manual-review');
  });

  it('remembers that it was hidden, and still toggles when storage is blocked', async () => {
    renderPalette();
    await userEvent.click(screen.getByRole('button', { name: 'Hide step palette' }));

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('tsh.canvas.paletteOpen')).toBe('false');

    cleanup();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderPalette();
    expect(screen.getByRole('searchbox')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Hide step palette' }));
    expect(screen.getByRole('button', { name: 'Show step palette' })).toBeVisible();
  });
});
