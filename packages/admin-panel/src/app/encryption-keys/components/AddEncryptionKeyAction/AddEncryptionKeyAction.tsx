import { useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';

export interface AddEncryptionKeyActionProps {
  /** True when encryption is off, so rotating has nothing to act on. */
  disabled: boolean;
  /** True while the add-key request is in flight. */
  pending: boolean;
  onAdd: () => void;
}

/**
 * Adding a key re-encrypts every onboarding onto it, so it sits behind the same inline two-click
 * confirm as `ConnectorCard`'s Clear action (`ConnectorCard.tsx:41,64-71`) rather than firing on
 * the first click. There is no modal `Dialog` in this codebase and this does not introduce one.
 */
export function AddEncryptionKeyAction({
  disabled,
  pending,
  onAdd,
}: AddEncryptionKeyActionProps): ReactElement {
  const [confirming, setConfirming] = useState(false);

  function handleClick(): void {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onAdd();
  }

  return (
    <div className="encryption-keys__actions">
      {confirming && (
        <span className="encryption-keys__confirm">
          This re-encrypts every stored onboarding onto the new key. Rotate now?
        </span>
      )}
      <Button variant="primary" disabled={disabled || pending} onClick={handleClick}>
        {confirming ? 'Confirm add key' : 'Add key'}
      </Button>
      {confirming && (
        <Button variant="quiet" disabled={pending} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      )}
    </div>
  );
}
