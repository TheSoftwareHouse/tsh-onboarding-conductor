import { useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';

export interface ReencryptActionProps {
  /** True while a request already stands, so the sweep is working and asking again changes nothing. */
  active: boolean;
  /** True while nothing can be asked for — no key-encryption key, or another write is in flight. */
  disabled: boolean;
  /** True while the request is in flight. */
  pending: boolean;
  onRequest: () => void;
}

/**
 * Asks the engine to move every stored onboarding onto the active key. Unlike rotating, this
 * rewrites data, so it sits behind the same inline two-click confirm as the other write actions.
 * While a request stands the button reports that rather than offering to repeat it: the request is
 * a standing flag the sweep clears itself, so asking twice only re-stamps it.
 */
export function ReencryptAction({
  active,
  disabled,
  pending,
  onRequest,
}: ReencryptActionProps): ReactElement {
  const [confirming, setConfirming] = useState(false);

  function handleClick(): void {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onRequest();
  }

  if (active) {
    return (
      <span className="text-body-sm text-fg-3">
        Re-encrypting every stored onboarding onto the active key.
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {confirming && (
        <span className="text-body-sm text-fg-3">
          This rewrites every stored onboarding onto the active key, a batch at a time. Nothing is
          ever stored unencrypted on the way. Re-encrypt now?
        </span>
      )}
      <Button variant="secondary" disabled={disabled || pending} onClick={handleClick}>
        {confirming ? 'Confirm re-encrypt' : 'Re-encrypt all'}
      </Button>
      {confirming && (
        <Button variant="quiet" disabled={pending} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      )}
    </div>
  );
}
