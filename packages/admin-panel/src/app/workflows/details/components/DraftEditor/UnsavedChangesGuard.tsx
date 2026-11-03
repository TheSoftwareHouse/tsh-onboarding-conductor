import { useEffect, type ReactElement, type RefObject } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { useBlocker, type BlockerFunction } from 'react-router';
import { Button } from '@/components/ui/Button/Button';
import { Close } from '@/components/ui/icons';
import { Typography } from '@/components/ui/Typography/Typography';
import { workflowVersionSearchParams } from '@/lib/workflow-search-params';

export interface UnsavedChangesGuardProps {
  /** True while the editor holds edits the stored draft does not. */
  when: boolean;
  /** Set by a write that succeeded and is about to navigate: the edits are stored or deleted, not lost. */
  isWritten: RefObject<boolean>;
}

const VERSION_KEY = 'version' satisfies keyof typeof workflowVersionSearchParams;

function readVersion(search: string): number | null {
  const raw = new URLSearchParams(search).get(VERSION_KEY);
  return raw === null ? null : workflowVersionSearchParams[VERSION_KEY].parse(raw);
}

/** Leaving the draft means another page or another version; a tab or step change stays on it. */
function isLeavingDraft({
  currentLocation,
  nextLocation,
}: Parameters<BlockerFunction>[0]): boolean {
  if (currentLocation.pathname !== nextLocation.pathname) return true;
  return readVersion(currentLocation.search) !== readVersion(nextLocation.search);
}

/** Asks before an in-app navigation drops unsaved edits; a reload or tab close gets the browser's own prompt. */
export function UnsavedChangesGuard({ when, isWritten }: UnsavedChangesGuardProps): ReactElement {
  // A ref, not `when`: the write navigates from its onSuccess, before the editor re-renders clean.
  const blocker = useBlocker((args) => when && !isWritten.current && isLeavingDraft(args));

  useEffect(() => {
    if (!when) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [when]);

  return (
    <Dialog.Root
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => !open && blocker.reset?.()}
    >
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
                  Leave without saving?
                </Dialog.Title>
              </div>
              <Dialog.Close aria-label="Close" className="cursor-pointer text-fg-3 hover:text-fg-1">
                <Close aria-hidden className="size-6" />
              </Dialog.Close>
            </header>
            <div className="p-6">
              <Typography variant="body-md">
                This draft has unsaved changes. Leaving now discards them.
              </Typography>
            </div>
            <footer className="flex items-center gap-3 border-t border-border-hair px-6 py-5">
              <Button variant="outline" onClick={() => blocker.reset?.()}>
                Stay
              </Button>
              <Button variant="danger-outline" onClick={() => blocker.proceed?.()}>
                Discard and leave
              </Button>
            </footer>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
