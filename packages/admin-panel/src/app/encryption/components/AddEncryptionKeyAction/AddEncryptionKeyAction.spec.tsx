import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddEncryptionKeyAction } from './AddEncryptionKeyAction';

afterEach(() => {
  cleanup();
});

describe('AddEncryptionKeyAction', () => {
  it('requires a confirmation click before onAdd fires', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<AddEncryptionKeyAction disabled={false} pending={false} onAdd={onAdd} />);

    await user.click(screen.getByRole('button', { name: 'Add key' }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(
      screen.getByText('This re-encrypts every stored onboarding onto the new key. Rotate now?'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm add key' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm add key' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Add key' })).toBeInTheDocument();
  });

  it('cancels back to the unconfirmed state without calling onAdd', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<AddEncryptionKeyAction disabled={false} pending={false} onAdd={onAdd} />);

    await user.click(screen.getByRole('button', { name: 'Add key' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add key' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('disables the action while disabled', () => {
    render(<AddEncryptionKeyAction disabled pending={false} onAdd={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add key' })).toBeDisabled();
  });

  it('disables the action while a request is in flight', () => {
    render(<AddEncryptionKeyAction disabled={false} pending onAdd={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add key' })).toBeDisabled();
  });
});
