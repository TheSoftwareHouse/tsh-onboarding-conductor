import { useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';

export interface DeleteDraftActionProps {
  disabled: boolean;
  onConfirm: () => void;
}

/** Deleting is final, so it sits behind the same inline two-click confirm as the other destructive actions. */
export function DeleteDraftAction({ disabled, onConfirm }: DeleteDraftActionProps): ReactElement {
  const [confirming, setConfirming] = useState(false);

  function handleClick(): void {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onConfirm();
  }

  return (
    <>
      {confirming && (
        <Button variant="quiet" disabled={disabled} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      )}
      <Button variant="danger-outline" disabled={disabled} onClick={handleClick}>
        {confirming ? 'Confirm delete' : 'Delete draft'}
      </Button>
    </>
  );
}
