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
    expect(screen.getByRole('button', { name: 'Confirm add key' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm add key' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('cancels back to the unconfirmed state without calling onAdd', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<AddEncryptionKeyAction disabled={false} pending={false} onAdd={onAdd} />);

    await user.click(screen.getByRole('button', { name: 'Add key' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add key' })).toBeInTheDocument();
  });

  it('disables the action while encryption is off', () => {
    render(<AddEncryptionKeyAction disabled pending={false} onAdd={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add key' })).toBeDisabled();
  });

  it('disables both buttons while a request is in flight', async () => {
    const user = userEvent.setup();
    render(<AddEncryptionKeyAction disabled={false} pending={false} onAdd={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Add key' }));

    cleanup();
    render(<AddEncryptionKeyAction disabled={false} pending onAdd={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add key' })).toBeDisabled();
  });
});
