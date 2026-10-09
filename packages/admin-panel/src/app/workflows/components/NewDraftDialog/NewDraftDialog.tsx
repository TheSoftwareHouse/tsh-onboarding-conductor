import type { ReactElement } from 'react';
import { useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from '@/components/ui/Button/Button';
import { Add, Close } from '@/components/ui/icons';
import { Typography } from '@/components/ui/Typography/Typography';
import { useCreateWorkflowDraft } from '../../hooks/useCreateWorkflowDraft';
import { NewDraftForm } from './NewDraftForm';

/** The "New draft" button and the dialog it opens: pick a start, create the draft, land in its editor. */
export function NewDraftDialog(): ReactElement {
  const [open, setOpen] = useState(false);
  const createMutation = useCreateWorkflowDraft();

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger render={<Button variant="primary" className="gap-2" />}>
        <Add aria-hidden className="size-4.5" />
        New draft
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-20 bg-tsh-black/35" />
        <Dialog.Viewport className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto px-6 py-16">
          <Dialog.Popup className="w-full max-w-160 border border-border-strong bg-bg-page">
            <header className="flex items-start justify-between gap-6 border-b border-border-hair p-6">
              <div className="flex flex-col gap-1.5">
                <Typography variant="caps-tiny" className="text-fg-4">
                  Workflows
                </Typography>
                <Dialog.Title render={<Typography variant="h6" as="h2" />}>New draft</Dialog.Title>
              </div>
              <Dialog.Close aria-label="Close" className="cursor-pointer text-fg-3 hover:text-fg-1">
                <Close aria-hidden className="size-6" />
              </Dialog.Close>
            </header>
            <NewDraftForm
              isSubmitting={createMutation.isPending}
              onSubmit={(document) =>
                createMutation.mutate(document, { onSuccess: () => setOpen(false) })
              }
              onCancel={() => setOpen(false)}
            />
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
