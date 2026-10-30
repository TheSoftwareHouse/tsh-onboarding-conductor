import type { ReactElement, ReactNode } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { Close, Delete } from '@/components/ui/icons';

export interface AddButtonProps {
  /** What the button adds, shown as `+ Add <children>`. */
  children: ReactNode;
  /** Names the button when its text alone is ambiguous, such as several on one panel. */
  'aria-label'?: string;
  onClick: () => void;
}

/** Adds an entry to a list or a setting; every add in the inspector looks the same. */
export function AddButton({
  children,
  'aria-label': ariaLabel,
  onClick,
}: AddButtonProps): ReactElement {
  return (
    <Button
      variant="outline"
      size="sm"
      className="self-start"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      + Add {children}
    </Button>
  );
}

export interface EntryActionProps {
  /** Shown as the tooltip and read as the accessible name, e.g. "Remove transition 2". */
  label: string;
  onClick: () => void;
}

/** Deletes an entry from a list: a transition, an arm, a rule, an agreement, a map or list entry. */
export function DeleteButton({ label, onClick }: EntryActionProps): ReactElement {
  return (
    <Button
      variant="danger"
      size="sm"
      className="h-7 px-1"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Delete aria-hidden className="size-4" />
    </Button>
  );
}

/** Clears an optional setting, which its Set button can bring back. */
export function ClearButton({ label, onClick }: EntryActionProps): ReactElement {
  return (
    <Button
      variant="quiet"
      size="sm"
      className="h-7 px-1"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Close aria-hidden className="size-4" />
    </Button>
  );
}
