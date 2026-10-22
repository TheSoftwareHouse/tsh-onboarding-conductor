// PoC (throwaway): the × that closes the canvas's side panel, styled as the dialogs' close button.
import type { ReactElement } from 'react';
import { Close } from '@/components/ui/icons';

export function PanelClose({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <button
      type="button"
      aria-label="Close"
      className="shrink-0 cursor-pointer text-fg-3 hover:text-fg-1"
      onClick={onClose}
    >
      <Close aria-hidden className="size-6" />
    </button>
  );
}
