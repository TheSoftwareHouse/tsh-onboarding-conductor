import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EncryptionToggleAction } from './EncryptionToggleAction';

afterEach(() => {
  cleanup();
});

describe('EncryptionToggleAction', () => {
  it('offers to turn encryption off while it is on, and confirms in danger colour before firing', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<EncryptionToggleAction enabled disabled={false} pending={false} onToggle={onToggle} />);

    await user.click(screen.getByRole('button', { name: 'Turn encryption off' }));
    expect(onToggle).not.toHaveBeenCalled();

    const warning = screen.getByText(
      'This decrypts every stored onboarding and stores it as plain JSON. Turn encryption off?',
    );
    expect(warning).toHaveClass('text-tsh-red');

    await user.click(screen.getByRole('button', { name: 'Confirm turn off' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('offers to turn encryption on while it is off, with the neutral confirm copy', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <EncryptionToggleAction
        enabled={false}
        disabled={false}
        pending={false}
        onToggle={onToggle}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Turn encryption on' }));
    expect(onToggle).not.toHaveBeenCalled();

    const warning = screen.getByText(
      'This encrypts every stored onboarding in the background. Turn encryption on?',
    );
    expect(warning).toHaveClass('text-fg-3');
    expect(warning).not.toHaveClass('text-tsh-red');

    await user.click(screen.getByRole('button', { name: 'Confirm turn on' }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('cancels back to the unconfirmed state without calling onToggle', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<EncryptionToggleAction enabled disabled={false} pending={false} onToggle={onToggle} />);

    await user.click(screen.getByRole('button', { name: 'Turn encryption off' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Turn encryption off' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('returns to the unconfirmed state after confirming', async () => {
    const user = userEvent.setup();
    render(
      <EncryptionToggleAction
        enabled={false}
        disabled={false}
        pending={false}
        onToggle={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Turn encryption on' }));
    await user.click(screen.getByRole('button', { name: 'Confirm turn on' }));

    expect(screen.getByRole('button', { name: 'Turn encryption on' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('disables the action while disabled', () => {
    render(<EncryptionToggleAction enabled={false} disabled pending={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Turn encryption on' })).toBeDisabled();
  });

  it('disables the action while a request is in flight', () => {
    render(<EncryptionToggleAction enabled disabled={false} pending onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Turn encryption off' })).toBeDisabled();
  });
});
