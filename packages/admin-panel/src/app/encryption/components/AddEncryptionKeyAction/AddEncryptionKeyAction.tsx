import { useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';

export interface AddEncryptionKeyActionProps {
  /** True while rotating has nothing to act on — the engine has no key-encryption key, or another write is in flight. */
  disabled: boolean;
  /** True while the add-key request is in flight. */
  pending: boolean;
  onAdd: () => void;
}

/**
 * Adding a key supersedes the active one and cannot be undone from the panel, so it sits behind
 * the same inline two-click confirm as `ConnectorCard`'s Clear action rather than firing on the
 * first click. It does not rewrite stored data: rotation is lazy, and a stored onboarding moves
 * onto the new key the next time it is written.
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
    <div className="flex flex-wrap items-center gap-2.5">
      {confirming && (
        <span className="text-body-sm text-tsh-red">
          New data uses the new key; stored onboardings move to it when next written. Rotate now?
        </span>
      )}
      <Button variant="secondary" disabled={disabled || pending} onClick={handleClick}>
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
