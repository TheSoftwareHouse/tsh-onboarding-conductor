import { useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { cn } from '@/lib/cn';

export interface EncryptionToggleActionProps {
  /** The state encryption is in now; the action offers the other one. */
  enabled: boolean;
  /** True while nothing can be toggled — the page is not ready, or the engine has no key-encryption key. */
  disabled: boolean;
  /** True while the toggle request is in flight. */
  pending: boolean;
  onToggle: (enabled: boolean) => void;
}

interface ToggleCopy {
  action: string;
  confirm: string;
  warning: string;
}

/** Keyed by the direction the click would move encryption in, not by the state it is in. */
const TOGGLE_COPY: Record<'on' | 'off', ToggleCopy> = {
  on: {
    action: 'Turn encryption on',
    confirm: 'Confirm turn on',
    warning: 'This encrypts every stored onboarding in the background. Turn encryption on?',
  },
  off: {
    action: 'Turn encryption off',
    confirm: 'Confirm turn off',
    warning:
      'This decrypts every stored onboarding and stores it as plain JSON. Turn encryption off?',
  },
};

/**
 * Either direction rewrites every stored onboarding, so both sit behind the same inline two-click
 * confirm as `AddEncryptionKeyAction` rather than firing on the first click. Only the off
 * direction carries the danger colour: it is the one that leaves data in plain JSON.
 */
export function EncryptionToggleAction({
  enabled,
  disabled,
  pending,
  onToggle,
}: EncryptionToggleActionProps): ReactElement {
  const [confirming, setConfirming] = useState(false);
  const direction = enabled ? 'off' : 'on';
  const copy = TOGGLE_COPY[direction];

  function handleClick(): void {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onToggle(!enabled);
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {confirming && (
        <span className={cn('text-body-sm', direction === 'off' ? 'text-tsh-red' : 'text-fg-3')}>
          {copy.warning}
        </span>
      )}
      <Button variant="primary" disabled={disabled || pending} onClick={handleClick}>
        {confirming ? copy.confirm : copy.action}
      </Button>
      {confirming && (
        <Button variant="quiet" disabled={pending} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      )}
    </div>
  );
}
