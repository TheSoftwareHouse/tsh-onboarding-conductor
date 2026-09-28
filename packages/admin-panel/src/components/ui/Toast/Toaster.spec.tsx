import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TOAST_ERROR_TIMEOUT_MS,
  TOAST_PROGRESS_TIMEOUT_MS,
  TOAST_SUCCESS_TIMEOUT_MS,
  TOAST_VISIBLE_LIMIT,
  showErrorToast,
  showProgressToast,
  showSuccessToast,
} from './toast-manager';
import { Toaster } from './Toaster';

function renderToaster() {
  return render(
    <Toaster>
      <div />
    </Toaster>,
  );
}

/** The toast root for `title` — `Toast.Title`/`Description` also carry `data-type`, so this walks to the outermost match. */
async function findToast(title: string): Promise<HTMLElement> {
  const nodes = await screen.findAllByText(title);
  for (const node of nodes) {
    let root: Element | null = null;
    for (let current: Element | null = node; current; current = current.parentElement) {
      if (current.hasAttribute('data-type')) {
        root = current;
      }
    }
    if (root) {
      return root as HTMLElement;
    }
  }
  throw new Error(`No toast root found for "${title}"`);
}

afterEach(() => {
  cleanup();
});

describe('Toaster', () => {
  it('renders a success toast with its title', async () => {
    renderToaster();

    act(() => {
      showSuccessToast('HubSpot settings saved.');
    });

    const toast = await findToast('HubSpot settings saved.');
    expect(toast).toHaveAttribute('data-type', 'success');
  });

  it('renders an error toast with its title and description, announced through the alert announcer', async () => {
    renderToaster();

    act(() => {
      showErrorToast('Unable to clear HubSpot:', 'Request failed with status 500.');
    });

    const toast = await findToast('Unable to clear HubSpot:');
    expect(toast).toHaveAttribute('data-type', 'error');
    expect(toast).toHaveTextContent('Request failed with status 500.');
    // Base UI announces a high-priority toast assertively through its hidden alert announcer.
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to clear HubSpot:');
  });

  it('renders a progress toast with its title, announced only through the polite region', async () => {
    renderToaster();

    act(() => {
      showProgressToast('Re-encrypting stored onboardings.');
    });

    const toast = await findToast('Re-encrypting stored onboardings.');
    expect(toast).toHaveAttribute('data-type', 'progress');
    // Progress uses the default priority, so no hidden alert announcer is rendered for it.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('dismisses a toast when its close button is clicked', async () => {
    renderToaster();

    act(() => {
      showSuccessToast('Dismiss me');
    });

    const toast = await findToast('Dismiss me');
    // The close button reaches the accessibility tree once the stack is hovered, like a mouse user.
    fireEvent.mouseEnter(toast);
    fireEvent.click(within(toast).getByRole('button', { name: 'Dismiss notification' }));

    await waitFor(() => expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument());
  });

  it('renders newest-first, so the newest toast stacks frontmost', async () => {
    renderToaster();

    act(() => {
      showSuccessToast('First');
      showSuccessToast('Second');
    });

    const titles = await screen.findAllByText(/^(First|Second)$/);
    expect(titles.map((title) => title.textContent)).toEqual(['Second', 'First']);
  });

  it('leaves three toasts visible and marks the oldest as limited', async () => {
    renderToaster();
    const titles = Array.from({ length: TOAST_VISIBLE_LIMIT + 1 }, (_, index) => `Toast ${index}`);

    act(() => {
      titles.forEach((title) => showSuccessToast(title));
    });

    const toasts = await Promise.all(titles.map(findToast));
    expect(toasts).toHaveLength(titles.length);
    // `titles[0]` ("Toast 0") was added first, so it is the oldest and the one Base UI limits.
    expect(toasts[0]).toHaveAttribute('data-limited');
    toasts.slice(1).forEach((toast) => expect(toast).not.toHaveAttribute('data-limited'));
  });

  describe('auto-dismiss', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('dismisses a success toast after 5 seconds', () => {
      renderToaster();

      act(() => {
        showSuccessToast('Auto success');
      });
      expect(screen.getByText('Auto success')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(TOAST_SUCCESS_TIMEOUT_MS);
      });
      expect(screen.queryByText('Auto success')).not.toBeInTheDocument();
    });

    it('dismisses an error toast after 10 seconds', () => {
      renderToaster();

      act(() => {
        showErrorToast('Auto error:', 'detail');
      });
      // The hidden alert announcer duplicates the title, so more than one match is expected.
      expect(screen.getAllByText('Auto error:').length).toBeGreaterThan(0);

      act(() => {
        vi.advanceTimersByTime(TOAST_ERROR_TIMEOUT_MS);
      });
      expect(screen.queryAllByText('Auto error:')).toHaveLength(0);
    });

    it('dismisses a progress toast after 5 seconds', () => {
      renderToaster();

      act(() => {
        showProgressToast('Auto progress');
      });
      expect(screen.getByText('Auto progress')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(TOAST_PROGRESS_TIMEOUT_MS);
      });
      expect(screen.queryByText('Auto progress')).not.toBeInTheDocument();
    });
  });
});
