import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pagination } from './Pagination';
import type { PaginationWindow } from '../lib/pagination';

function window(overrides: Partial<PaginationWindow> = {}): PaginationWindow {
  return { page: 1, limit: 20, total: 41, totalPages: 3, ...overrides };
}

function renderPager(
  overrides: Partial<PaginationWindow> = {},
  disabled = false,
): { onPageChange: (page: number) => void } {
  const onPageChange = vi.fn();
  render(
    <Pagination
      pagination={window(overrides)}
      label="Onboarding pages"
      disabled={disabled}
      onPageChange={onPageChange}
    />,
  );

  return { onPageChange };
}

afterEach(() => {
  cleanup();
});

describe('Pagination', () => {
  it('reports the window the endpoint returned', () => {
    renderPager({ page: 2 });

    expect(screen.getByLabelText('Page')).toHaveValue('2');
    expect(screen.getByRole('navigation', { name: 'Onboarding pages' })).toHaveTextContent('of 3');
  });

  it('steps a page at a time with the arrows', async () => {
    const { onPageChange } = renderPager({ page: 2 });

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });

  it('cannot step beyond either end of the window', () => {
    renderPager({ page: 1 });
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    cleanup();
    renderPager({ page: 3 });
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('jumps to the page the operator typed once it is committed', async () => {
    const { onPageChange } = renderPager();
    const pageInput = screen.getByLabelText('Page');

    await userEvent.clear(pageInput);
    await userEvent.type(pageInput, '3');
    expect(onPageChange).not.toHaveBeenCalled();

    await userEvent.keyboard('{Enter}');
    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(3);
  });

  it('clamps a typed page to the window rather than requesting one that does not exist', async () => {
    const { onPageChange } = renderPager();
    const pageInput = screen.getByLabelText('Page');

    await userEvent.clear(pageInput);
    await userEvent.type(pageInput, '99{Enter}');

    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(3);
    expect(pageInput).toHaveValue('3');
  });

  it('stays put when the typed page is the one already shown', async () => {
    const { onPageChange } = renderPager({ page: 2 });
    const pageInput = screen.getByLabelText('Page');

    await userEvent.clear(pageInput);
    await userEvent.type(pageInput, '2{Enter}');

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('restores the current page when a typed value names none', async () => {
    const { onPageChange } = renderPager({ page: 2 });
    const pageInput = screen.getByLabelText('Page');

    await userEvent.clear(pageInput);
    await userEvent.type(pageInput, 'abc{Enter}');

    expect(onPageChange).not.toHaveBeenCalled();
    expect(pageInput).toHaveValue('2');
  });

  it('puts the current page back when the operator leaves without committing', async () => {
    const { onPageChange } = renderPager({ page: 2 });
    const pageInput = screen.getByLabelText('Page');

    await userEvent.clear(pageInput);
    await userEvent.type(pageInput, '3');
    await userEvent.tab();

    expect(onPageChange).not.toHaveBeenCalled();
    expect(pageInput).toHaveValue('2');
  });

  it('shows the page the endpoint reported after a jump, replacing what was typed', async () => {
    const { rerender } = render(
      <Pagination
        pagination={window({ page: 1 })}
        label="Onboarding pages"
        disabled={false}
        onPageChange={vi.fn()}
      />,
    );

    await userEvent.clear(screen.getByLabelText('Page'));
    await userEvent.type(screen.getByLabelText('Page'), '3');

    rerender(
      <Pagination
        pagination={window({ page: 2 })}
        label="Onboarding pages"
        disabled={false}
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Page')).toHaveValue('2');
  });

  it('takes no input while a request is in flight', () => {
    renderPager({ page: 2 }, true);

    expect(screen.getByLabelText('Page')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});
