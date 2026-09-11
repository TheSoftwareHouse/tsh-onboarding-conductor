import type { ReactElement, ReactNode } from 'react';
import { tv } from '@/shared/lib/tv';

/** Shared by `TextFilterField` and `SelectFilterField`, the two controls a `FilterField` wraps. */
export const filterControl = tv({
  base: 'h-10 w-full rounded-none border border-border-strong bg-bg-page px-3 text-body-sm text-fg-1 enabled:hover:border-tsh-black disabled:text-fg-disabled aria-invalid:border-tsh-red',
});

/** What every filter control needs to label itself and report a refused value. */
export interface FilterControlProps {
  /** Id the label points at, and the handle tests and the e2e suite reach the control by. */
  id: string;
  /** Query key the criterion maps to, carried as the control name so the form reads as the query. */
  name: string;
  label: string;
  disabled: boolean;
  /** Id of the panel message describing why this value was refused, when one applies. */
  describedBy?: string;
  /** Whether the current value was refused, which marks the control for assistive technology. */
  invalid?: boolean;
}

export interface FilterFieldProps {
  controlId: string;
  label: string;
  children: ReactNode;
}

/** Labelled cell one criterion occupies in a `FilterPanel` grid. */
export function FilterField({ controlId, label, children }: FilterFieldProps): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={controlId} className="text-caps-tiny text-fg-3 uppercase">
        {label}
      </label>
      {children}
    </div>
  );
}
