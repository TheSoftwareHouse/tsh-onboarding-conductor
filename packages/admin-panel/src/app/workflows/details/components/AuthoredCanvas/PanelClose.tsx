import type { ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { Close } from '@/components/ui/icons';

export function PanelClose({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <Button variant="quiet" size="sm" className="h-7 px-1" aria-label="Close" onClick={onClose}>
      <Close aria-hidden className="size-6" />
    </Button>
  );
}
