import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublishDraftDialog, type PublishDraftDialogProps } from './PublishDraftDialog';

afterEach(cleanup);

function renderDialog(props: Partial<PublishDraftDialogProps> = {}): PublishDraftDialogProps {
  const merged: PublishDraftDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    workflowId: 'my-flow',
    name: 'My flow',
    version: 3,
    isPending: false,
    onConfirm: vi.fn(),
    ...props,
  };
  render(<PublishDraftDialog {...merged} />);
  return merged;
}

describe('PublishDraftDialog', () => {
  it('titles the dialog with the name and version', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'Publish My flow v3' })).toBeInTheDocument();
  });

  it('falls back to the workflow id when there is no name', () => {
    renderDialog({ name: null });
    expect(screen.getByRole('dialog', { name: 'Publish my-flow v3' })).toBeInTheDocument();
  });

  it('shows the permanence warning, the new-onboardings line and the Publish button', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Publish My flow v3' });
    expect(dialog).toHaveTextContent(
      'Publishing is permanent: a published version cannot be edited or deleted.',
    );
    expect(dialog).toHaveTextContent('New onboardings will start on this version.');
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
  });

  it('confirms through onConfirm', async () => {
    const { onConfirm } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables the confirm and shows progress while pending', () => {
    renderDialog({ isPending: true });
    expect(screen.getByRole('button', { name: 'Publishing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('cannot be dismissed with Escape while pending', async () => {
    const { onOpenChange } = renderDialog({ isPending: true });
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('closes through Cancel', async () => {
    const { onOpenChange } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
