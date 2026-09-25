import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReencryptAction } from './ReencryptAction';

afterEach(() => {
  cleanup();
});

describe('ReencryptAction', () => {
  it('asks for confirmation before requesting anything, since it rewrites every stored onboarding', async () => {
    const onRequest = vi.fn();
    render(
      <ReencryptAction active={false} disabled={false} pending={false} onRequest={onRequest} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Re-encrypt all' }));

    expect(onRequest).not.toHaveBeenCalled();
    expect(
      screen.getByText(/rewrites every stored onboarding onto the active key, a batch at a time/),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Confirm re-encrypt' }));

    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it('abandons the confirmation on cancel', async () => {
    const onRequest = vi.fn();
    render(
      <ReencryptAction active={false} disabled={false} pending={false} onRequest={onRequest} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Re-encrypt all' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onRequest).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Re-encrypt all' })).toBeInTheDocument();
  });

  it('reports the work in progress instead of offering to ask again', () => {
    render(<ReencryptAction active disabled={false} pending={false} onRequest={vi.fn()} />);

    // The request is a standing flag the sweep clears itself, so asking twice only re-stamps it.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(
      screen.getByText('Re-encrypting every stored onboarding onto the active key.'),
    ).toBeInTheDocument();
  });

  it('cannot be used while another write is in flight, or while this one is', () => {
    const { rerender } = render(
      <ReencryptAction active={false} disabled pending={false} onRequest={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Re-encrypt all' })).toBeDisabled();

    rerender(<ReencryptAction active={false} disabled={false} pending onRequest={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Re-encrypt all' })).toBeDisabled();
  });
});
