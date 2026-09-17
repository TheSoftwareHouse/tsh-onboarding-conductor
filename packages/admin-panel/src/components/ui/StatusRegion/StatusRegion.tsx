import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface StatusRegionProps {
  children: ReactNode;
  /** Set `false` for a region whose first render must not be announced. Defaults to `true`. */
  live?: boolean;
  className?: string;
}

/** A polite live region for status text — result counts, load errors — announced without a focus move. */
export function StatusRegion({
  children,
  live = true,
  className,
}: StatusRegionProps): ReactElement {
  return (
    <p
      role="status"
      aria-live={live ? 'polite' : 'off'}
      className={cn('text-body-sm text-fg-3', className)}
    >
      {children}
    </p>
  );
}
