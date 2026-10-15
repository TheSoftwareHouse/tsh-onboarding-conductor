import type { ReactElement } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from '@/components/ui/Button/Button';
import { Close } from '@/components/ui/icons';
import { Typography } from '@/components/ui/Typography/Typography';

export interface PublishDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  name: string | null;
  version: number;
  isPending: boolean;
  onConfirm: () => void;
}

/** Confirms the irreversible publish of a saved draft; failures surface as toasts, not here. */
export function PublishDraftDialog({
  open,
  onOpenChange,
  workflowId,
  name,
  version,
  isPending,
  onConfirm,
}: PublishDraftDialogProps): ReactElement {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-20 bg-tsh-black/35" />
        <Dialog.Viewport className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto px-6 py-16">
          <Dialog.Popup className="w-full max-w-160 border border-border-strong bg-bg-page">
            <header className="flex items-start justify-between gap-6 border-b border-border-hair p-6">
              <div className="flex flex-col gap-1.5">
                <Typography variant="caps-tiny" className="text-fg-4">
                  Workflows
                </Typography>
                <Dialog.Title render={<Typography variant="h6" as="h2" />}>
                  Publish {name ?? workflowId} v{version}
                </Dialog.Title>
              </div>
              <Dialog.Close
                aria-label="Close"
                disabled={isPending}
                className="cursor-pointer text-fg-3 hover:text-fg-1"
              >
                <Close aria-hidden className="size-6" />
              </Dialog.Close>
            </header>
            <div className="flex flex-col gap-3 p-6">
              <Typography variant="body-md">
                Publishing is permanent: a published version cannot be edited or deleted.
              </Typography>
              <Typography variant="body-md">New onboardings will start on this version.</Typography>
            </div>
            <footer className="flex items-center gap-3 border-t border-border-hair px-6 py-5">
              <Button variant="primary" disabled={isPending} onClick={onConfirm}>
                {isPending ? 'Publishing…' : 'Publish'}
              </Button>
              <Button variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            </footer>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
